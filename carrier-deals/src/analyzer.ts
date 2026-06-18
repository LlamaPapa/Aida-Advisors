import Anthropic from '@anthropic-ai/sdk';
import type { RawPost, AnalyzedDeal } from './types.js';

const client = new Anthropic();

const BATCH_SIZE = 20;

interface ClaudeAnalysis {
  postIndex: number;
  isActualDeal: boolean;
  dealValue: string;
  promoDetails: string;
  requirements: string[];
  expirationDate: string | null;
  rating: number;
  relevanceScore: number;
  summary: string;
}

async function analyzeBatch(posts: RawPost[], offset: number): Promise<AnalyzedDeal[]> {
  const postsText = posts
    .map(
      (p, i) =>
        `[Post ${i + 1}]
Source: ${p.source}${p.subreddit ? ` (r/${p.subreddit})` : ''}
Title: ${p.title}
Content: ${p.body || '(no body)'}
URL: ${p.url}
Date: ${p.created.toISOString().split('T')[0]}
Upvotes: ${p.upvotes ?? 'N/A'}`,
    )
    .join('\n---\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are filtering social media posts to find actionable deals for switching from Verizon to T-Mobile.

Analyze each post and respond with a JSON array. Only include posts where isActualDeal is true OR relevanceScore >= 6. Discard general complaints, news articles without deal specifics, and unrelated posts.

For each relevant post return:
{
  "postIndex": <1-based number>,
  "isActualDeal": <true if post describes a specific current promotion/offer>,
  "dealValue": "<dollar amount, percentage off, free device, etc. — empty string if none>",
  "promoDetails": "<what exactly the deal includes>",
  "requirements": ["<requirement1>", ...],
  "expirationDate": "<date string or null>",
  "rating": <1–5, where 5 = excellent verified high-value deal>,
  "relevanceScore": <1–10, where 10 = perfect for someone leaving Verizon for T-Mobile>,
  "summary": "<one sentence summary>"
}

Posts:
${postsText}

Return a valid JSON array only. No markdown, no explanation.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') return [];

  try {
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const analyzed = JSON.parse(jsonMatch[0]) as ClaudeAnalysis[];

    return analyzed
      .filter((a) => a.isActualDeal || a.relevanceScore >= 6)
      .map((a) => {
        const post = posts[a.postIndex - 1];
        if (!post) return null;
        return {
          post,
          isActualDeal: a.isActualDeal,
          dealValue: a.dealValue,
          promoDetails: a.promoDetails,
          requirements: a.requirements,
          expirationDate: a.expirationDate,
          rating: a.rating,
          relevanceScore: a.relevanceScore,
          summary: a.summary,
        } as AnalyzedDeal;
      })
      .filter((d): d is AnalyzedDeal => d !== null);
  } catch (err) {
    console.error('Failed to parse Claude response:', err);
    return [];
  }
}


export async function analyzePosts(posts: RawPost[]): Promise<AnalyzedDeal[]> {
  if (posts.length === 0) return [];

  const deals: AnalyzedDeal[] = [];

  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    console.log(`  Analyzing posts ${i + 1}–${i + batch.length}...`);
    const batchDeals = await analyzeBatch(batch, i);
    deals.push(...batchDeals);
  }

  // Sort by combined score: relevance + rating
  return deals.sort(
    (a, b) => b.relevanceScore + b.rating * 2 - (a.relevanceScore + a.rating * 2),
  );
}

export async function generateExecutiveSummary(
  deals: AnalyzedDeal[],
  date: string,
): Promise<string> {
  if (deals.length === 0) {
    return `No significant T-Mobile switching deals found for Verizon customers on ${date}. Check back tomorrow.`;
  }

  const dealLines = deals
    .slice(0, 5)
    .map(
      (d) =>
        `- ${d.summary} | Value: ${d.dealValue || 'see details'} | Rating: ${d.rating}/5 | Relevance: ${d.relevanceScore}/10`,
    )
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Write a 2-3 sentence executive summary for someone deciding whether to switch from Verizon to T-Mobile today (${date}).

Top deals found:
${dealLines}

Be specific about the best deal and any key caveats. Actionable and concise.`,
      },
    ],
  });

  const content = response.content[0];
  return content.type === 'text' ? content.text.trim() : 'Summary unavailable.';
}
