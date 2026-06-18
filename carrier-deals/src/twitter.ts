import type { RawPost } from './types.js';

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

// Searches targeting T-Mobile deals for Verizon switchers
const SEARCH_QUERIES = [
  '(T-Mobile OR TMobile) (switch OR switching) (deal OR promo OR promotion OR offer) Verizon -is:retweet lang:en',
  '(T-Mobile OR TMobile) "switch from Verizon" (deal OR credit OR free OR discount) -is:retweet lang:en',
  '(T-Mobile OR TMobile) (switcher OR "switching deal" OR "switch deal") -is:retweet lang:en',
];

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
  };
}

interface TwitterSearchResponse {
  data?: Tweet[];
  meta?: { result_count: number; newest_id: string };
}

async function searchTweets(query: string): Promise<RawPost[]> {
  const params = new URLSearchParams({
    query,
    max_results: '25',
    'tweet.fields': 'created_at,author_id,public_metrics',
    expansions: 'author_id',
    'user.fields': 'username',
  });

  const url = `https://api.twitter.com/2/tweets/search/recent?${params}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(`Twitter API returned ${response.status}: ${body}`);
    return [];
  }

  const data = (await response.json()) as TwitterSearchResponse;

  if (!data.data || data.data.length === 0) return [];

  return data.data.map((tweet) => ({
    id: tweet.id,
    source: 'twitter' as const,
    title: tweet.text.slice(0, 100),
    body: tweet.text,
    url: `https://x.com/i/web/status/${tweet.id}`,
    author: tweet.author_id,
    created: new Date(tweet.created_at),
    upvotes: tweet.public_metrics?.like_count,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchTwitter(): Promise<RawPost[]> {
  if (!BEARER_TOKEN) {
    console.log('TWITTER_BEARER_TOKEN not configured — skipping X search');
    return [];
  }

  const posts: RawPost[] = [];
  const seen = new Set<string>();

  for (const query of SEARCH_QUERIES) {
    try {
      const results = await searchTweets(query);
      for (const post of results) {
        if (!seen.has(post.id)) {
          seen.add(post.id);
          posts.push(post);
        }
      }
      // Twitter rate limits: stay well under the cap
      await sleep(2500);
    } catch (err) {
      console.warn('Error searching X/Twitter:', err);
    }
  }

  return posts;
}
