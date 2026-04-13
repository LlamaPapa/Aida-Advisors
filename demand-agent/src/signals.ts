/**
 * Signal collection.
 *
 * A "signal" is any real-world evidence relevant to a hypothesis:
 *   - a page fetched from the web (Fiverr listings, Reddit thread, forum)
 *   - a raw text blob provided by the operator (TikTok comments dump, CSV)
 *   - a search-results URL the operator pre-wired
 *
 * The agent asks Claude which signals to collect for each hypothesis by reading
 * the validationPlan; the plan entries either look like URLs or free-text
 * "find X on platform Y" instructions. Free-text instructions require the
 * operator to pre-wire seed URLs, because this package does not ship with
 * credentialed scrapers for third-party platforms.
 */

import { EvaluatedSignal, RawSignal } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_EXCERPT = 4000;

/** Very permissive URL detection — matches http(s) schemes only. */
const URL_RE = /https?:\/\/[^\s)"'<>]+/g;

/** Strip HTML tags, collapse whitespace, cap length for Claude. */
export function toExcerpt(raw: string, max = MAX_EXCERPT): string {
  const noScript = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScript.replace(/<[^>]+>/g, ' ');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const collapsed = decoded.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
}

/** Extract http(s) URLs from a free-text validation step. */
export function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_RE) ?? []));
}

export interface FetchResult {
  url: string;
  ok: boolean;
  status?: number;
  content?: string;
  error?: string;
}

/** Fetch a URL, tolerating failures. Returns text body or an error. */
export async function fetchUrl(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AidaDemandAgent/1.0; +https://aidaadvisors.com)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();

    return {
      url,
      ok: res.ok,
      status: res.status,
      content: contentType.includes('application/json')
        ? body
        : toExcerpt(body),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a raw signal (URL or blob) into an evaluated signal with an excerpt.
 * Never throws — failed fetches become signals tagged contradicts/weak.
 */
export async function collectRawSignal(
  raw: RawSignal,
  timeoutMs: number
): Promise<EvaluatedSignal> {
  const fetchedAt = new Date().toISOString();

  if (raw.content && raw.content.trim()) {
    return {
      ...raw,
      content: raw.content,
      fetchedAt,
      excerpt: toExcerpt(raw.content),
    };
  }

  if (raw.url) {
    const result = await fetchUrl(raw.url, timeoutMs);
    if (result.ok && result.content) {
      return {
        ...raw,
        url: raw.url,
        content: result.content,
        fetchedAt,
        excerpt: toExcerpt(result.content),
      };
    }
    const errText = `FETCH FAILED (${result.status ?? 'network'}): ${result.error ?? 'non-2xx'}`;
    return {
      ...raw,
      url: raw.url,
      content: errText,
      fetchedAt,
      excerpt: errText,
      weight: 'weak',
    };
  }

  return {
    ...raw,
    content: '(empty signal)',
    fetchedAt,
    excerpt: '(empty signal)',
    weight: 'weak',
  };
}

/**
 * Given a list of validationPlan strings, return the URLs to fetch.
 * Non-URL entries are ignored — the operator should pre-wire URLs as seedSignals.
 */
export function urlsFromValidationPlan(plan: string[]): string[] {
  const all: string[] = [];
  for (const step of plan) all.push(...extractUrls(step));
  return Array.from(new Set(all));
}
