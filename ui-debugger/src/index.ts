/**
 * Debug Pipeline
 *
 * Autonomous debugging pipeline powered by Claude Opus 4.5.
 *
 * Usage as library:
 *   import { runPipeline, quickRun } from '@aida/debug-pipeline';
 *   const result = await runPipeline({ projectRoot: './my-project' });
 *
 * Usage as CLI:
 *   debug-pipeline run ./my-project
 *
 * Usage as server:
 *   debug-pipeline-server (or npm start)
 */

export * from './types.js';
export * from './pipeline.js';
export {
  analyzeFailure,
  generateFixPrompt,
  extractFilePaths,
  gatherFileContext,
} from './analyzer.js';
export {
  getGitStatus,
  createSnapshot,
  getDiff,
  getChangedFiles,
  commitChanges,
  rollback,
  discardChanges,
} from './git.js';
export {
  verify,
  quickVerify,
  fetchPlan,
  checkImplementation,
  generateTestPlan,
  generateFlags,
} from './verificationAgent.js';
