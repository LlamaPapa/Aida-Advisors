/**
 * Claude-powered research core.
 *
 * Four pure-ish functions that wrap Anthropic calls:
 *   1. proposeHypotheses  — cold start or refined from learnings
 *   2. scoreHypothesis    — grades a hypothesis against collected signals
 *   3. synthesizeLearnings — turns a failed round into a prompt for the next
 *   4. buildPlan          — emits the final GTM artifact once a winner is chosen
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import {
  Brief,
  Hypothesis,
  EvaluatedSignal,
  GoToMarketPlan,
} from './types.js';

const MODEL = 'claude-opus-4-5-20251101';

let client: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!client) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY not set. Pass it via config or environment variable.');
    }
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

function extractText(response: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

function usageOf(response: Anthropic.Messages.Message): TokenUsage {
  const input = response.usage?.input_tokens ?? 0;
  const output = response.usage?.output_tokens ?? 0;
  return { input, output, total: input + output };
}

function extractJson<T>(text: string): T | null {
  // Prefer the last fenced JSON block, fall back to first {...} or [...]
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() || text.match(/[\[{][\s\S]*[\]}]/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function briefBlock(brief: Brief): string {
  return [
    `GOAL: ${brief.goal}`,
    `BUDGET: $${brief.budget}`,
    brief.hoursPerWeek ? `TIME: ${brief.hoursPerWeek} hrs/week` : null,
    brief.skills?.length ? `SKILLS/ASSETS: ${brief.skills.join(', ')}` : null,
    brief.constraints?.length ? `CONSTRAINTS: ${brief.constraints.join(', ')}` : null,
    brief.channels?.length ? `CHANNEL HINTS: ${brief.channels.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Propose N fresh demand hypotheses for the given brief.
 * Pass `priorLearnings` on subsequent iterations so the model doesn't repeat itself.
 */
export async function proposeHypotheses(
  brief: Brief,
  count: number,
  priorLearnings: string | undefined,
  apiKey: string | undefined
): Promise<{ hypotheses: Hypothesis[]; usage: TokenUsage }> {
  const anthropic = getClient(apiKey);

  const systemPrompt = `You are a demand-finding operator. You find real, paying demand before anything is built.

Your job each round: propose ${count} sharply-specified demand hypotheses the operator can test cheaply and fast. Prefer hypotheses where willingness-to-pay is observable today (existing listings, existing complaints, existing purchases elsewhere) over speculative ones.

Respond in JSON ONLY, matching this schema exactly:
{
  "hypotheses": [
    {
      "title": "Concrete one-liner",
      "audience": "Who exactly buys. Be specific (role, company size, geo).",
      "pain": "The painful job-to-be-done. Must be observable.",
      "offer": "The deliverable + how it's packaged (e.g. 3-day turnaround, $297 flat).",
      "channel": "Where you find them TODAY (specific subreddit, specific marketplace, specific hashtag, specific directory).",
      "price": 297,
      "validationPlan": [
        "Concrete observable signal #1 — e.g. 'find 20 open Fiverr requests matching this offer in last 30 days'",
        "Concrete observable signal #2",
        "Concrete observable signal #3"
      ],
      "rationale": "Why this is promising and how it addresses the brief's constraints."
    }
  ]
}

Rules:
- Every hypothesis must name a SPECIFIC channel that can be searched/scraped today.
- Every validationPlan item must be something the operator can check within 24h.
- Do NOT propose building software, SaaS, or products that take >1 week to ship a v1.
- Respect the brief's hard constraints. If the operator said "no coding", do not propose coding work.`;

  const userPrompt = [
    briefBlock(brief),
    '',
    priorLearnings
      ? `PRIOR LEARNINGS (these hypotheses DID NOT validate — learn from them, do not repeat):\n${priorLearnings}`
      : 'This is round 1. Start from first principles.',
    '',
    `Propose ${count} hypotheses now.`,
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = extractText(response);
  const parsed = extractJson<{ hypotheses: Omit<Hypothesis, 'id' | 'signals'>[] }>(text);

  if (!parsed?.hypotheses?.length) {
    throw new Error('proposeHypotheses: Claude did not return a valid hypotheses array.');
  }

  const hypotheses: Hypothesis[] = parsed.hypotheses.map((h) => ({
    id: randomUUID(),
    title: h.title,
    audience: h.audience,
    pain: h.pain,
    offer: h.offer,
    channel: h.channel,
    price: typeof h.price === 'number' ? h.price : Number(h.price) || 0,
    validationPlan: Array.isArray(h.validationPlan) ? h.validationPlan : [],
    signals: [],
    rationale: h.rationale,
  }));

  return { hypotheses, usage: usageOf(response) };
}

/**
 * Score a single hypothesis against its collected signals.
 * Returns 0–100 confidence, a brief verdict, and per-signal weights.
 */
export async function scoreHypothesis(
  brief: Brief,
  hypothesis: Hypothesis,
  apiKey: string | undefined
): Promise<{
  score: number;
  verdict: string;
  signalWeights: Array<{ source: string; weight: EvaluatedSignal['weight'] }>;
  usage: TokenUsage;
}> {
  const anthropic = getClient(apiKey);

  const signalSummary = hypothesis.signals.length
    ? hypothesis.signals
        .map(
          (s, i) =>
            `[${i + 1}] source=${s.source}${s.url ? ` url=${s.url}` : ''}\n--- excerpt ---\n${s.excerpt}\n--- end ---`
        )
        .join('\n\n')
    : '(no signals collected)';

  const systemPrompt = `You are a skeptical demand-validation analyst. You grade a hypothesis against real-world signals.

Grade 0-100 using this rubric:
- 0-29:   No observable demand. Speculative. Move on.
- 30-49:  Weak/ambiguous. Some pain, unclear willingness to pay.
- 50-69:  Real pain visible. Willingness-to-pay unclear or price unvalidated.
- 70-84:  Real pain + clear willingness to pay observable. Path to first dollar <7 days.
- 85-100: Customers are actively asking for this, at the proposed price, on the proposed channel. Ship now.

Only promote (>= 75) when you see concrete evidence, not vibes. Absence of signal is NOT validation.

Respond in JSON ONLY:
{
  "score": 0-100,
  "verdict": "2-3 sentences explaining the grade, citing specific signal numbers (e.g. 'signal [2] shows...').",
  "signalWeights": [
    { "source": "exact source string from the signal", "weight": "strong|moderate|weak|contradicts" }
  ]
}`;

  const userPrompt = [
    briefBlock(brief),
    '',
    `HYPOTHESIS:`,
    `- title: ${hypothesis.title}`,
    `- audience: ${hypothesis.audience}`,
    `- pain: ${hypothesis.pain}`,
    `- offer: ${hypothesis.offer}`,
    `- channel: ${hypothesis.channel}`,
    `- price: $${hypothesis.price}`,
    `- validationPlan: ${hypothesis.validationPlan.join(' | ')}`,
    '',
    'COLLECTED SIGNALS:',
    signalSummary,
    '',
    'Grade this hypothesis now.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 4000 },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = extractText(response);
  const parsed = extractJson<{
    score: number;
    verdict: string;
    signalWeights: Array<{ source: string; weight: EvaluatedSignal['weight'] }>;
  }>(text);

  if (!parsed) {
    return {
      score: 0,
      verdict: 'Could not parse grading response.',
      signalWeights: [],
      usage: usageOf(response),
    };
  }

  return {
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    verdict: parsed.verdict || '',
    signalWeights: Array.isArray(parsed.signalWeights) ? parsed.signalWeights : [],
    usage: usageOf(response),
  };
}

/**
 * After a round with no validated winner, synthesize why and what to try next.
 * Output is fed back into proposeHypotheses as priorLearnings.
 */
export async function synthesizeLearnings(
  brief: Brief,
  roundHypotheses: Hypothesis[],
  apiKey: string | undefined
): Promise<{ learnings: string; usage: TokenUsage }> {
  const anthropic = getClient(apiKey);

  const summary = roundHypotheses
    .map(
      (h) =>
        `- "${h.title}" (score ${h.score ?? '?'}) — ${h.verdict ?? 'no verdict'}`
    )
    .join('\n');

  const systemPrompt = `You are a demand-research strategist. You just finished a round where no hypothesis validated. Extract the lesson.

Output a single concise paragraph (4-6 sentences) that:
1. Names the common failure pattern across this round (e.g. "all ideas targeted saturated consumer marketplaces").
2. Names the most promising fragment — which pain or audience showed the faintest-but-real signal.
3. Gives the next round CONCRETE pivot instructions (e.g. "move upmarket to B2B", "switch channel from Fiverr to LinkedIn DMs", "attack the same pain with a done-with-you offer instead of done-for-you").

Plain prose, no JSON, no markdown, no preamble.`;

  const userPrompt = [
    briefBlock(brief),
    '',
    'ROUND RESULTS:',
    summary,
    '',
    'Write the learnings paragraph now.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return { learnings: extractText(response).trim(), usage: usageOf(response) };
}

/**
 * Produce the final go-to-market plan for the validated hypothesis.
 */
export async function buildPlan(
  brief: Brief,
  winner: Hypothesis,
  apiKey: string | undefined
): Promise<{ plan: GoToMarketPlan; usage: TokenUsage }> {
  const anthropic = getClient(apiKey);

  const systemPrompt = `You are an operator writing the launch plan for a VALIDATED demand hypothesis. The evidence already exists — your job is the shortest path from zero to first dollar.

Respond in JSON ONLY:
{
  "headline": "One sentence the operator can post today.",
  "offer": "Productized offer with deliverable, timeline, and guarantee.",
  "pricing": "Price and any tiering.",
  "icp": "Specific ideal customer profile — who to approach first.",
  "firstFiveMoves": [
    "Move 1 — do today",
    "Move 2 — do today",
    "Move 3 — this week",
    "Move 4 — this week",
    "Move 5 — this week"
  ],
  "pitch": "90-120 word outreach message they can copy-paste.",
  "risks": ["top risk 1", "top risk 2"],
  "successMetric": "The ONE number to watch (e.g. 'paid orders in first 14 days')."
}`;

  const userPrompt = [
    briefBlock(brief),
    '',
    'VALIDATED HYPOTHESIS:',
    JSON.stringify(
      {
        title: winner.title,
        audience: winner.audience,
        pain: winner.pain,
        offer: winner.offer,
        channel: winner.channel,
        price: winner.price,
        verdict: winner.verdict,
        score: winner.score,
      },
      null,
      2
    ),
    '',
    'Write the go-to-market plan now.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = extractText(response);
  const parsed = extractJson<Omit<GoToMarketPlan, 'hypothesisId'>>(text);
  if (!parsed) throw new Error('buildPlan: Claude did not return a valid plan.');

  return {
    plan: { hypothesisId: winner.id, ...parsed },
    usage: usageOf(response),
  };
}
