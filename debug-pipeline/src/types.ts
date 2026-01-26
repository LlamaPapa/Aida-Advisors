/**
 * Debug Pipeline Types
 */

export type PipelineStage = 'idle' | 'building' | 'testing' | 'analyzing' | 'fixing' | 'verifying' | 'complete' | 'failed';

export interface PipelineConfig {
  projectRoot: string;
  projectId?: string;
  buildCommand?: string;
  testCommand?: string;
  maxFixAttempts?: number;
  autoFix?: boolean;
  runTests?: boolean;
  timeout?: number;
  useClaudeCode?: boolean;
  claudeCodePath?: string;
  anthropicApiKey?: string;
  // Git integration
  gitEnabled?: boolean;
  gitCommitFixes?: boolean;
  gitBranchPrefix?: string;
  // Callbacks
  onLog?: (message: string) => void;
  onStageChange?: (stage: PipelineStage) => void;
}

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface DebugAnalysis {
  hypotheses: Array<{
    probability: 'high' | 'medium' | 'low';
    category: string;
    description: string;
    suggestedFix: string;
    affectedFiles?: string[];
  }>;
  rootCause?: {
    file?: string;
    line?: number;
    description: string;
    confidence: number;
  };
  affectedFiles: string[];
  suggestedStrategy: 'auto-fix' | 'targeted-fix' | 'rollback' | 'manual' | 'skip';
  confidence: number;
}

export interface FixAttempt {
  attempt: number;
  analysis: DebugAnalysis;
  fixPrompt: string;
  claudeCodeOutput?: string;
  result: CommandResult;
  timestamp: string;
  // Git tracking
  commitHash?: string;
  filesDiff?: string;
  filesChanged?: string[];
}

export interface PipelineRun {
  id: string;
  projectId: string;
  projectRoot: string;
  status: PipelineStage;
  buildResult?: CommandResult;
  testResult?: CommandResult;
  fixAttempts: FixAttempt[];
  startedAt: string;
  completedAt?: string;
  duration?: number;
  success: boolean;
  summary?: string;
  error?: string;
}

export interface PipelineState {
  isRunning: boolean;
  currentRun: PipelineRun | null;
  history: PipelineRun[];
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalFixAttempts: number;
    successfulFixes: number;
  };
}
