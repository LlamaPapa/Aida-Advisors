export interface RawPost {
  id: string;
  source: 'reddit' | 'twitter';
  title: string;
  body: string;
  url: string;
  author: string;
  created: Date;
  upvotes?: number;
  subreddit?: string;
}

export interface AnalyzedDeal {
  post: RawPost;
  isActualDeal: boolean;
  dealValue: string;
  promoDetails: string;
  requirements: string[];
  expirationDate: string | null;
  rating: number;
  relevanceScore: number;
  summary: string;
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  postsScanned: number;
  dealsFound: number;
  topDeals: AnalyzedDeal[];
  executiveSummary: string;
}
