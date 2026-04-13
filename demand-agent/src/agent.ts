/**
 * Autonomous Demand Agent — the loop.
 *
 * Given a Brief, it will:
 *   1. propose N hypotheses         (ideating)
 *   2. collect signals for each     (collecting)
 *   3. score each against signals   (scoring)
 *   4. if any score >= threshold AND has enough confirming signals:
 *        -> build GTM plan          (planning) -> complete
 *      else:
 *        -> synthesize learnings    (refining) -> loop to step 1
 *
 * Stop conditions:
 *   - validated winner found                       (success)
 *   - maxIterations reached without validation     (stop, unvalidated)
 *   - token budget exhausted                       (stop, unvalidated)
 *   - stopAgent() called externally                (stop, manual)
 *   - fatal error                                  (stop, error)
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  AgentConfig,
  AgentIteration,
  AgentRun,
  AgentStage,
  AgentState,
  EvaluatedSignal,
  Hypothesis,
} from './types.js';
import {
  proposeHypotheses,
  scoreHypothesis,
  synthesizeLearnings,
  buildPlan,
  TokenUsage,
} from './research.js';
import { collectRawSignal, urlsFromValidationPlan } from './signals.js';

export const agentEvents = new EventEmitter();

/** Tracks which runs have been asked to stop. Checked at every loop boundary. */
const cancelled = new Set<string>();

const DEFAULTS = {
  maxIterations: 8,
  validationThreshold: 75,
  minConfirmingSignals: 3,
  hypothesesPerRound: 5,
  maxTokens: 2_000_000,
  fetchTimeoutMs: 15_000,
};

const state: AgentState = {
  isRunning: false,
  currentRun: null,
  history: [],
  stats: {
    totalRuns: 0,
    validatedRuns: 0,
    unvalidatedRuns: 0,
    totalIterations: 0,
    totalTokens: 0,
  },
};

export function getState(): AgentState {
  return { ...state };
}

export function getRun(runId: string): AgentRun | undefined {
  if (state.currentRun?.id === runId) return state.currentRun;
  return state.history.find((r) => r.id === runId);
}

export function getHistory(): AgentRun[] {
  return [...state.history];
}

function updateStage(run: AgentRun, stage: AgentStage, config: AgentConfig) {
  run.status = stage;
  config.onStageChange?.(stage);
  agentEvents.emit('stage', { runId: run.id, stage });
  agentEvents.emit('update', run);
}

function log(run: AgentRun, message: string, config: AgentConfig) {
  const timestamp = new Date().toISOString();
  config.onLog?.(`[${timestamp}] ${message}`);
  agentEvents.emit('log', { runId: run.id, message, timestamp });
}

function finishRun(run: AgentRun): AgentRun {
  run.completedAt = new Date().toISOString();
  run.duration = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();

  state.isRunning = false;
  state.currentRun = null;
  state.history.unshift(run);
  if (state.history.length > 50) state.history = state.history.slice(0, 50);

  if (run.success) state.stats.validatedRuns++;
  else state.stats.unvalidatedRuns++;

  agentEvents.emit('complete', run);
  return run;
}

/**
 * Collect signals for every hypothesis in this round.
 * Uses URLs embedded in validationPlan steps (operators can pre-wire real URLs).
 * Also inherits any seedSignals from the brief, attached to the top hypothesis by default.
 */
async function collectForRound(
  hypotheses: Hypothesis[],
  briefSeed: EvaluatedSignal[],
  fetchTimeoutMs: number,
  onProgress: (msg: string) => void
): Promise<void> {
  for (const h of hypotheses) {
    const urls = urlsFromValidationPlan(h.validationPlan);
    onProgress(`  "${h.title}" — collecting ${urls.length} URL(s)`);

    const collected: EvaluatedSignal[] = [];
    for (const url of urls) {
      const signal = await collectRawSignal(
        { source: `validation:${url}`, url },
        fetchTimeoutMs
      );
      signal.hypothesisId = h.id;
      collected.push(signal);
    }
    h.signals.push(...collected);
  }

  // Share seed signals with ALL hypotheses so Claude can notice cross-cutting patterns.
  for (const seed of briefSeed) {
    for (const h of hypotheses) {
      h.signals.push({ ...seed, hypothesisId: h.id });
    }
  }
}

function countConfirming(h: Hypothesis): number {
  return h.signals.filter((s) => s.weight === 'strong' || s.weight === 'moderate').length;
}

function mergeUsage(run: AgentRun, usage: TokenUsage) {
  run.totalTokens += usage.total;
  state.stats.totalTokens += usage.total;
}

/**
 * Run the autonomous demand-finding loop.
 */
export async function runAgent(config: AgentConfig): Promise<AgentRun> {
  const cfg: Required<Omit<AgentConfig, 'anthropicApiKey' | 'onLog' | 'onStageChange'>> & {
    anthropicApiKey?: string;
    onLog?: (m: string) => void;
    onStageChange?: (s: AgentStage) => void;
  } = {
    ...DEFAULTS,
    ...config,
  };

  const run: AgentRun = {
    id: randomUUID(),
    brief: cfg.brief,
    status: 'idle',
    iterations: [],
    startedAt: new Date().toISOString(),
    totalTokens: 0,
    success: false,
  };

  state.isRunning = true;
  state.currentRun = run;
  state.stats.totalRuns++;
  agentEvents.emit('start', run);

  // Pre-collect any seedSignals supplied by the brief (fetch URLs, normalize blobs)
  const briefSeed: EvaluatedSignal[] = [];
  for (const s of cfg.brief.seedSignals ?? []) {
    briefSeed.push(await collectRawSignal(s, cfg.fetchTimeoutMs));
  }
  if (briefSeed.length) log(run, `Seeded with ${briefSeed.length} operator-provided signal(s).`, cfg);

  let learnings: string | undefined;

  try {
    for (let iteration = 1; iteration <= cfg.maxIterations; iteration++) {
      if (cancelled.has(run.id)) {
        run.status = 'failed';
        run.success = false;
        run.error = 'Manually stopped';
        log(run, 'Run cancelled by stopAgent().', cfg);
        cancelled.delete(run.id);
        return finishRun(run);
      }

      // Token safety
      if (run.totalTokens >= cfg.maxTokens) {
        run.error = `Token budget exhausted (${run.totalTokens}/${cfg.maxTokens}).`;
        log(run, run.error, cfg);
        break;
      }

      state.stats.totalIterations++;
      log(run, `=== Iteration ${iteration}/${cfg.maxIterations} ===`, cfg);

      // 1. IDEATE
      updateStage(run, 'ideating', cfg);
      log(run, `Proposing ${cfg.hypothesesPerRound} hypotheses...`, cfg);
      const { hypotheses, usage: ideateUsage } = await proposeHypotheses(
        cfg.brief,
        cfg.hypothesesPerRound,
        learnings,
        cfg.anthropicApiKey
      );
      mergeUsage(run, ideateUsage);
      log(
        run,
        `Proposed ${hypotheses.length} hypotheses: ${hypotheses.map((h) => `"${h.title}"`).join(', ')}`,
        cfg
      );

      // 2. COLLECT
      updateStage(run, 'collecting', cfg);
      log(run, 'Collecting signals...', cfg);
      await collectForRound(hypotheses, briefSeed, cfg.fetchTimeoutMs, (m) => log(run, m, cfg));

      // 3. SCORE
      updateStage(run, 'scoring', cfg);
      for (const h of hypotheses) {
        log(run, `Scoring "${h.title}" against ${h.signals.length} signals...`, cfg);
        const { score, verdict, signalWeights, usage } = await scoreHypothesis(
          cfg.brief,
          h,
          cfg.anthropicApiKey
        );
        mergeUsage(run, usage);

        h.score = score;
        h.verdict = verdict;

        // Attach weights by matching source strings
        for (const w of signalWeights) {
          const sig = h.signals.find((s) => s.source === w.source);
          if (sig) sig.weight = w.weight;
        }
        log(run, `  score=${score} — ${verdict}`, cfg);
      }

      // Persist iteration snapshot
      const sorted = [...hypotheses].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const top = sorted[0];
      const snapshot: AgentIteration = {
        iteration,
        stage: run.status,
        hypotheses: sorted,
        topHypothesisId: top?.id,
        topScore: top?.score,
        learnings,
        timestamp: new Date().toISOString(),
        tokensUsed: run.totalTokens,
      };
      run.iterations.push(snapshot);
      agentEvents.emit('iteration', { runId: run.id, iteration: snapshot });

      // 4. DECIDE
      if (top && (top.score ?? 0) >= cfg.validationThreshold) {
        const confirming = countConfirming(top);
        if (confirming >= cfg.minConfirmingSignals) {
          log(
            run,
            `Hypothesis validated: "${top.title}" (score ${top.score}, confirming signals ${confirming}).`,
            cfg
          );
          run.winner = top;

          updateStage(run, 'planning', cfg);
          const { plan, usage } = await buildPlan(cfg.brief, top, cfg.anthropicApiKey);
          mergeUsage(run, usage);
          run.plan = plan;

          run.status = 'complete';
          run.success = true;
          run.summary = `Validated "${top.title}" on iteration ${iteration}. Score ${top.score}, confirming signals ${confirming}.`;
          log(run, `DEMAND VALIDATED. ${run.summary}`, cfg);
          return finishRun(run);
        }
        log(
          run,
          `Top hypothesis "${top.title}" scored ${top.score} but has only ${confirming} confirming signals (need ${cfg.minConfirmingSignals}). Refining...`,
          cfg
        );
      } else {
        log(
          run,
          `No hypothesis reached threshold (${cfg.validationThreshold}). Top score: ${top?.score ?? 0}. Refining...`,
          cfg
        );
      }

      // 5. REFINE
      if (iteration < cfg.maxIterations) {
        updateStage(run, 'refining', cfg);
        const { learnings: next, usage } = await synthesizeLearnings(
          cfg.brief,
          hypotheses,
          cfg.anthropicApiKey
        );
        mergeUsage(run, usage);
        learnings = next;
        log(run, `Learnings for next round: ${learnings}`, cfg);
      }
    }

    // Exhausted iterations without a winner
    run.status = 'failed';
    run.success = false;
    run.summary =
      run.error ??
      `No hypothesis validated within ${cfg.maxIterations} iterations. Best score: ${
        Math.max(0, ...run.iterations.map((i) => i.topScore ?? 0))
      }.`;
    log(run, `STOPPED UNVALIDATED: ${run.summary}`, cfg);
    return finishRun(run);
  } catch (error) {
    run.status = 'failed';
    run.success = false;
    run.error = error instanceof Error ? error.message : 'Unknown error';
    log(run, `AGENT ERROR: ${run.error}`, cfg);
    return finishRun(run);
  }
}

/**
 * Request cancellation of the current run. The loop honors this at the next
 * iteration boundary and emits the normal `complete` event.
 */
export function stopAgent(): boolean {
  if (!state.isRunning || !state.currentRun) return false;
  cancelled.add(state.currentRun.id);
  return true;
}
