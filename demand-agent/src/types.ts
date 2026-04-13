/**
 * Demand Agent Types
 *
 * Domain model for an autonomous loop that finds validated demand.
 */

export type AgentStage =
  | 'idle'
  | 'ideating'       // Claude proposes hypotheses
  | 'collecting'     // fetching real-world signals
  | 'scoring'        // Claude scores hypotheses against signals
  | 'refining'       // no validated winner yet -> synthesize learnings and loop
  | 'planning'       // winner found -> draft go-to-market plan
  | 'complete'
  | 'failed';

/** The user's starting constraints. What they have, what they want, what they won't do. */
export interface Brief {
  /** Plain-English goal, e.g. "generate $20,000 in profit within 60 days". */
  goal: string;
  /** Cash available in USD. */
  budget: number;
  /** Hours per week the operator can realistically spend. */
  hoursPerWeek?: number;
  /** Existing skills, assets, audiences, tools. Free text list. */
  skills?: string[];
  /** Hard constraints, e.g. "no coding", "US-only", "no paid ads". */
  constraints?: string[];
  /** Optional channel hints to bias first searches (e.g. fiverr, upwork, reddit, tiktok, etherscan). */
  channels?: string[];
  /** Optional seed URLs or data blobs the operator already has evidence from. */
  seedSignals?: RawSignal[];
}

/** A raw input fed into the agent — could be a URL to scrape, a blob of text, or a structured datum. */
export interface RawSignal {
  /** Where it came from — free text tag. */
  source: string;
  /** If the agent should GET this URL during `collecting`. */
  url?: string;
  /** Pre-fetched text content (comments, forum threads, listings, etc.). */
  content?: string;
  /** Optional metadata (e.g. { upvotes: 42, platform: 'reddit' }). */
  meta?: Record<string, unknown>;
}

/** A signal after collection — always has content, tagged with sentiment/pain indicators by Claude. */
export interface EvaluatedSignal extends RawSignal {
  content: string;
  fetchedAt: string;
  /** Truncated to a workable size before being shown to Claude. */
  excerpt: string;
  /** How strongly it supports the linked hypothesis. */
  weight?: 'strong' | 'moderate' | 'weak' | 'contradicts';
  /** Whose hypothesis this signal was collected for. */
  hypothesisId?: string;
}

/** A demand hypothesis is an offer/audience pair the agent is testing. */
export interface Hypothesis {
  id: string;
  /** Short label, e.g. "SWOT analyses for restaurant owners on Fiverr". */
  title: string;
  /** Who the customer is. */
  audience: string;
  /** What pain you're solving. */
  pain: string;
  /** What you're selling (deliverable + packaging). */
  offer: string;
  /** Where you'll reach them. */
  channel: string;
  /** Price point in USD. */
  price: number;
  /** What evidence, if observed, would validate this. Used to design the signal collection. */
  validationPlan: string[];
  /** Signals collected while testing this hypothesis. */
  signals: EvaluatedSignal[];
  /** Claude's latest score, 0-100. */
  score?: number;
  /** Brief reasoning from the most recent scoring pass. */
  verdict?: string;
  /** Why this was proposed (carries learnings from prior iterations). */
  rationale?: string;
}

/** The final artifact when a hypothesis is validated. */
export interface GoToMarketPlan {
  hypothesisId: string;
  headline: string;
  offer: string;
  pricing: string;
  icp: string;
  firstFiveMoves: string[];
  pitch: string;
  risks: string[];
  successMetric: string;
}

export interface AgentConfig {
  brief: Brief;
  /** Maximum loop iterations before giving up. Default 8. */
  maxIterations?: number;
  /** Validation threshold. Hypothesis with score >= this is promoted. Default 75. */
  validationThreshold?: number;
  /** Minimum confirming signals required before promotion. Default 3. */
  minConfirmingSignals?: number;
  /** How many hypotheses to generate per round. Default 5. */
  hypothesesPerRound?: number;
  /** Hard token budget across the whole run. Default 2_000_000. */
  maxTokens?: number;
  /** Timeout per HTTP fetch in ms. Default 15_000. */
  fetchTimeoutMs?: number;
  anthropicApiKey?: string;
  onLog?: (message: string) => void;
  onStageChange?: (stage: AgentStage) => void;
}

export interface AgentIteration {
  iteration: number;
  stage: AgentStage;
  hypotheses: Hypothesis[];
  topHypothesisId?: string;
  topScore?: number;
  learnings?: string;
  timestamp: string;
  tokensUsed: number;
}

export interface AgentRun {
  id: string;
  brief: Brief;
  status: AgentStage;
  iterations: AgentIteration[];
  winner?: Hypothesis;
  plan?: GoToMarketPlan;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  totalTokens: number;
  success: boolean;
  summary?: string;
  error?: string;
}

export interface AgentState {
  isRunning: boolean;
  currentRun: AgentRun | null;
  history: AgentRun[];
  stats: {
    totalRuns: number;
    validatedRuns: number;
    unvalidatedRuns: number;
    totalIterations: number;
    totalTokens: number;
  };
}
