import type { RawPost } from './types.js';

const USER_AGENT = 'AidaAdvisors:CarrierDealBot:1.0';

const SUBREDDITS = ['tmobile', 'verizon', 'NoContract', 'deals', 'mobilecarrierdeals', 'Frugal'];

const SEARCH_QUERIES = [
  'T-Mobile switch deal Verizon',
  'T-Mobile promotion switcher',
];

interface RedditChild {
  data: {
    id: string;
    title: string;
    selftext: string;
    url: string;
    author: string;
    created_utc: number;
    ups: number;
    subreddit: string;
    permalink: string;
  };
}

interface RedditResponse {
  data: {
    children: RedditChild[];
  };
}

async function searchSubreddit(subreddit: string, query: string): Promise<RawPost[]> {
  const params = new URLSearchParams({
    q: query,
    sort: 'new',
    limit: '25',
    t: 'week',
    restrict_sr: '1',
  });
  const url = `https://www.reddit.com/r/${subreddit}/search.json?${params}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    console.warn(`Reddit r/${subreddit} returned ${response.status}`);
    return [];
  }

  const data = (await response.json()) as RedditResponse;

  return data.data.children.map((child) => ({
    id: child.data.id,
    source: 'reddit' as const,
    title: child.data.title,
    body: child.data.selftext.slice(0, 600),
    url: `https://reddit.com${child.data.permalink}`,
    author: child.data.author,
    created: new Date(child.data.created_utc * 1000),
    upvotes: child.data.ups,
    subreddit: child.data.subreddit,
  }));
}

async function globalRedditSearch(query: string): Promise<RawPost[]> {
  const params = new URLSearchParams({
    q: query,
    sort: 'new',
    limit: '25',
    t: 'week',
  });
  const url = `https://www.reddit.com/search.json?${params}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    console.warn(`Reddit global search returned ${response.status}`);
    return [];
  }

  const data = (await response.json()) as RedditResponse;

  return data.data.children.map((child) => ({
    id: child.data.id,
    source: 'reddit' as const,
    title: child.data.title,
    body: child.data.selftext.slice(0, 600),
    url: `https://reddit.com${child.data.permalink}`,
    author: child.data.author,
    created: new Date(child.data.created_utc * 1000),
    upvotes: child.data.ups,
    subreddit: child.data.subreddit,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchReddit(): Promise<RawPost[]> {
  const posts: RawPost[] = [];
  const seen = new Set<string>();

  function addPosts(newPosts: RawPost[]): void {
    for (const post of newPosts) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        posts.push(post);
      }
    }
  }

  // Per-subreddit search
  for (const subreddit of SUBREDDITS) {
    for (const query of SEARCH_QUERIES) {
      try {
        const results = await searchSubreddit(subreddit, query);
        addPosts(results);
        await sleep(1100);
      } catch (err) {
        console.warn(`Error searching r/${subreddit}:`, err);
      }
    }
  }

  // Global search for cross-subreddit coverage
  for (const query of SEARCH_QUERIES) {
    try {
      const results = await globalRedditSearch(query);
      addPosts(results);
      await sleep(1100);
    } catch (err) {
      console.warn('Error in global Reddit search:', err);
    }
  }

  return posts;
}
