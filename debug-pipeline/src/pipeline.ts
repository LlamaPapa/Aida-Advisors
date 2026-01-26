/**
 * Debug Pipeline
 *
 * The brain that ties everything together:
 * 1. Runs build → captures output
 * 2. On failure → Claude Opus 4.5 analyzes (with file context)
 * 3. Generates fix prompt → optionally spawns Claude Code
 * 4. Git: snapshots before, commits after, rollback on failure
 * 5. Verifies fix → loops until success or max attempts
 */

import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  PipelineConfig,
  PipelineRun,
  PipelineStage,
  PipelineState,
  CommandResult,
  FixAttempt,
} from './types.js';
import { analyzeFailure, generateFixPrompt } from './analyzer.js';
import {
  getGitStatus,
  createSnapshot,
  getDiff,
  getChangedFiles,
  commitChanges,
  rollback,
  discardChanges,
  GitSnapshot,
} from './git.js';

// Event emitter for real-time updates
export const pipelineEvents = new EventEmitter();

// State
const state: PipelineState = {
  isRunning: false,
  currentRun: null,
  history: [],
  stats: {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    totalFixAttempts: 0,
    successfulFixes: 0,
  },
};

// Defaults
const DEFAULTS = {
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  maxFixAttempts: 3,
  autoFix: true,
  runTests: true,
  timeout: 300000,
  useClaudeCode: true,
  gitEnabled: true,
  gitCommitFixes: true,
  gitBranchPrefix: 'debug-pipeline',
};

export function getState(): PipelineState {
  return { ...state };
}

export function getRun(runId: string): PipelineRun | undefined {
  if (state.currentRun?.id === runId) return state.currentRun;
  return state.history.find(r => r.id === runId);
}

export function getHistory(): PipelineRun[] {
  return [...state.history];
}

/**
 * Execute a command and capture output
 */
async function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  onLog?: (msg: string) => void
): Promise<CommandResult> {
  const startTime = Date.now();

  return new Promise(resolve => {
    const [cmd, ...args] = command.split(' ');
    const proc = spawn(cmd, args, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      const text = data.toString();
      stdout += text;
      onLog?.(`[stdout] ${text.trim()}`);
    });

    proc.stderr.on('data', data => {
      const text = data.toString();
      stderr += text;
      onLog?.(`[stderr] ${text.trim()}`);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr: stderr + '\n[TIMEOUT] Command exceeded time limit',
        duration: Date.now() - startTime,
      });
    }, timeout);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        exitCode: code ?? -1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr: stderr + '\n' + err.message,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Run Claude Code to apply fix
 */
async function runClaudeCode(
  projectRoot: string,
  prompt: string,
  claudeCodePath?: string
): Promise<string> {
  const claudePath = claudeCodePath || 'claude';

  try {
    const result = execSync(
      `cd "${projectRoot}" && ${claudePath} --print "${prompt.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      {
        encoding: 'utf-8',
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    return result;
  } catch (error: any) {
    return `Claude Code execution failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
  }
}

function updateStage(run: PipelineRun, stage: PipelineStage, config: PipelineConfig) {
  run.status = stage;
  config.onStageChange?.(stage);
  pipelineEvents.emit('stage', { runId: run.id, stage });
  pipelineEvents.emit('update', run);
}

function log(run: PipelineRun, message: string, config: PipelineConfig) {
  const timestamp = new Date().toISOString();
  config.onLog?.(`[${timestamp}] ${message}`);
  pipelineEvents.emit('log', { runId: run.id, message, timestamp });
}

/**
 * Run the full debugging pipeline
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineRun> {
  const cfg = {
    ...DEFAULTS,
    ...config,
    projectId: config.projectId || path.basename(config.projectRoot),
  };

  const run: PipelineRun = {
    id: randomUUID(),
    projectId: cfg.projectId,
    projectRoot: cfg.projectRoot,
    status: 'idle',
    fixAttempts: [],
    startedAt: new Date().toISOString(),
    success: false,
  };

  state.isRunning = true;
  state.currentRun = run;
  state.stats.totalRuns++;

  pipelineEvents.emit('start', run);

  // Git setup
  let gitSnapshot: GitSnapshot | null = null;
  const gitStatus = cfg.gitEnabled ? getGitStatus(cfg.projectRoot) : null;

  if (gitStatus?.isRepo) {
    log(run, `Git repo detected on branch: ${gitStatus.branch}`, cfg);
    if (gitStatus.hasChanges) {
      log(run, `Warning: ${gitStatus.changedFiles.length} uncommitted changes`, cfg);
    }
    gitSnapshot = createSnapshot(cfg.projectRoot);
    if (gitSnapshot) {
      log(run, `Created snapshot at ${gitSnapshot.commitHash.slice(0, 8)}`, cfg);
    }
  }

  try {
    // === PHASE 1: BUILD ===
    log(run, `Starting build: ${cfg.buildCommand}`, cfg);
    updateStage(run, 'building', cfg);

    let buildResult = await executeCommand(
      cfg.buildCommand!,
      cfg.projectRoot,
      cfg.timeout!,
      msg => log(run, msg, cfg)
    );

    run.buildResult = buildResult;

    // Build failed - enter fix loop
    let fixAttempt = 0;
    while (!buildResult.success && fixAttempt < cfg.maxFixAttempts! && cfg.autoFix) {
      fixAttempt++;
      state.stats.totalFixAttempts++;
      log(run, `Build failed. Fix attempt ${fixAttempt}/${cfg.maxFixAttempts}`, cfg);

      // Analyze failure (now with file context!)
      updateStage(run, 'analyzing', cfg);
      log(run, 'Analyzing failure with Claude Opus 4.5 (with source context)...', cfg);

      const analysis = await analyzeFailure(
        'build',
        buildResult.stderr + '\n' + buildResult.stdout,
        cfg.anthropicApiKey,
        cfg.projectRoot  // Pass projectRoot for file context
      );

      log(run, `Analysis: ${analysis.hypotheses.length} hypotheses, confidence: ${analysis.confidence}`, cfg);
      if (analysis.rootCause?.file) {
        log(run, `Root cause: ${analysis.rootCause.file}:${analysis.rootCause.line || '?'} - ${analysis.rootCause.description}`, cfg);
      }

      // Generate fix prompt
      updateStage(run, 'fixing', cfg);
      const fixPrompt = await generateFixPrompt(
        cfg.projectRoot,
        buildResult.stderr + '\n' + buildResult.stdout,
        analysis,
        cfg.anthropicApiKey
      );

      log(run, `Generated fix prompt (${fixPrompt.length} chars)`, cfg);

      // Apply fix with Claude Code
      let claudeOutput = '';
      if (cfg.useClaudeCode) {
        log(run, 'Running Claude Code to apply fix...', cfg);
        claudeOutput = await runClaudeCode(cfg.projectRoot, fixPrompt, cfg.claudeCodePath);
        log(run, `Claude Code completed`, cfg);
      } else {
        log(run, 'Claude Code disabled - fix prompt generated but not applied', cfg);
        log(run, `FIX PROMPT:\n${fixPrompt}`, cfg);
      }

      // Track git changes
      let commitHash: string | undefined;
      let filesDiff: string | undefined;
      let filesChanged: string[] | undefined;

      if (gitStatus?.isRepo && cfg.gitEnabled) {
        filesChanged = getChangedFiles(cfg.projectRoot);
        filesDiff = getDiff(cfg.projectRoot);

        if (filesChanged.length > 0) {
          log(run, `Changed files: ${filesChanged.join(', ')}`, cfg);

          if (cfg.gitCommitFixes) {
            commitHash = commitChanges(
              cfg.projectRoot,
              `[debug-pipeline] Fix attempt ${fixAttempt}: ${analysis.hypotheses[0]?.description?.slice(0, 50) || 'auto-fix'}`
            ) || undefined;
            if (commitHash) {
              log(run, `Committed fix: ${commitHash.slice(0, 8)}`, cfg);
            }
          }
        }
      }

      // Verify fix
      updateStage(run, 'verifying', cfg);
      log(run, 'Verifying fix...', cfg);

      buildResult = await executeCommand(
        cfg.buildCommand!,
        cfg.projectRoot,
        cfg.timeout!,
        msg => log(run, msg, cfg)
      );

      const fixAttemptRecord: FixAttempt = {
        attempt: fixAttempt,
        analysis,
        fixPrompt,
        claudeCodeOutput: claudeOutput,
        result: buildResult,
        timestamp: new Date().toISOString(),
        commitHash,
        filesDiff,
        filesChanged,
      };

      run.fixAttempts.push(fixAttemptRecord);
      run.buildResult = buildResult;

      if (buildResult.success) {
        state.stats.successfulFixes++;
        log(run, `Build FIXED on attempt ${fixAttempt}!`, cfg);
      } else if (gitSnapshot && cfg.gitEnabled && !cfg.gitCommitFixes) {
        // Rollback if fix didn't work and we're not committing
        log(run, 'Fix failed, discarding changes...', cfg);
        discardChanges(cfg.projectRoot);
      }
    }

    if (!buildResult.success) {
      run.status = 'failed';
      run.success = false;
      run.error = 'Build failed after all fix attempts';
      run.summary = `Build failed. ${fixAttempt} fix attempts made.`;
      state.stats.failedRuns++;
      log(run, `PIPELINE FAILED: ${run.error}`, cfg);

      // Offer rollback info
      if (gitSnapshot) {
        log(run, `To rollback: git reset --hard ${gitSnapshot.commitHash}`, cfg);
      }

      return finishRun(run);
    }

    log(run, 'Build successful!', cfg);

    // === PHASE 2: TESTS ===
    if (cfg.runTests) {
      log(run, `Starting tests: ${cfg.testCommand}`, cfg);
      updateStage(run, 'testing', cfg);

      let testResult = await executeCommand(
        cfg.testCommand!,
        cfg.projectRoot,
        cfg.timeout!,
        msg => log(run, msg, cfg)
      );

      run.testResult = testResult;

      fixAttempt = 0;
      while (!testResult.success && fixAttempt < cfg.maxFixAttempts! && cfg.autoFix) {
        fixAttempt++;
        state.stats.totalFixAttempts++;
        log(run, `Tests failed. Fix attempt ${fixAttempt}/${cfg.maxFixAttempts}`, cfg);

        updateStage(run, 'analyzing', cfg);
        log(run, 'Analyzing test failure with Claude Opus 4.5 (with source context)...', cfg);

        const analysis = await analyzeFailure(
          'test',
          testResult.stderr + '\n' + testResult.stdout,
          cfg.anthropicApiKey,
          cfg.projectRoot  // Pass projectRoot for file context
        );

        updateStage(run, 'fixing', cfg);
        const fixPrompt = await generateFixPrompt(
          cfg.projectRoot,
          testResult.stderr + '\n' + testResult.stdout,
          analysis,
          cfg.anthropicApiKey
        );

        let claudeOutput = '';
        if (cfg.useClaudeCode) {
          log(run, 'Running Claude Code to apply fix...', cfg);
          claudeOutput = await runClaudeCode(cfg.projectRoot, fixPrompt, cfg.claudeCodePath);
        }

        // Track git changes
        let commitHash: string | undefined;
        let filesDiff: string | undefined;
        let filesChanged: string[] | undefined;

        if (gitStatus?.isRepo && cfg.gitEnabled) {
          filesChanged = getChangedFiles(cfg.projectRoot);
          filesDiff = getDiff(cfg.projectRoot);

          if (filesChanged.length > 0 && cfg.gitCommitFixes) {
            commitHash = commitChanges(
              cfg.projectRoot,
              `[debug-pipeline] Test fix ${fixAttempt}: ${analysis.hypotheses[0]?.description?.slice(0, 50) || 'auto-fix'}`
            ) || undefined;
            if (commitHash) {
              log(run, `Committed test fix: ${commitHash.slice(0, 8)}`, cfg);
            }
          }
        }

        // Re-verify build first
        updateStage(run, 'verifying', cfg);
        const rebuildResult = await executeCommand(cfg.buildCommand!, cfg.projectRoot, cfg.timeout!);

        if (!rebuildResult.success) {
          log(run, 'Fix broke the build! Rolling back...', cfg);
          if (gitStatus?.isRepo && commitHash) {
            // Rollback the bad commit
            rollback(cfg.projectRoot, 'HEAD~1');
          }
          continue;
        }

        testResult = await executeCommand(
          cfg.testCommand!,
          cfg.projectRoot,
          cfg.timeout!,
          msg => log(run, msg, cfg)
        );

        run.fixAttempts.push({
          attempt: fixAttempt,
          analysis,
          fixPrompt,
          claudeCodeOutput: claudeOutput,
          result: testResult,
          timestamp: new Date().toISOString(),
          commitHash,
          filesDiff,
          filesChanged,
        });

        run.testResult = testResult;

        if (testResult.success) {
          state.stats.successfulFixes++;
          log(run, `Tests FIXED on attempt ${fixAttempt}!`, cfg);
        }
      }

      if (!testResult.success) {
        run.status = 'failed';
        run.success = false;
        run.error = 'Tests failed after all fix attempts';
        run.summary = `Tests failed. ${fixAttempt} fix attempts. Build OK.`;
        state.stats.failedRuns++;
        log(run, `PIPELINE FAILED: ${run.error}`, cfg);

        if (gitSnapshot) {
          log(run, `To rollback all fixes: git reset --hard ${gitSnapshot.commitHash}`, cfg);
        }

        return finishRun(run);
      }

      log(run, 'All tests passed!', cfg);
    }

    // === SUCCESS ===
    run.status = 'complete';
    run.success = true;
    run.summary = `Pipeline complete. Build: OK${cfg.runTests ? ', Tests: OK' : ''}. ${run.fixAttempts.length} fixes applied.`;
    state.stats.successfulRuns++;
    log(run, `PIPELINE SUCCESS: ${run.summary}`, cfg);

    return finishRun(run);
  } catch (error) {
    run.status = 'failed';
    run.success = false;
    run.error = error instanceof Error ? error.message : 'Unknown error';
    state.stats.failedRuns++;
    log(run, `PIPELINE ERROR: ${run.error}`, cfg);

    if (gitSnapshot) {
      log(run, `To rollback: git reset --hard ${gitSnapshot.commitHash}`, cfg);
    }

    return finishRun(run);
  }
}

function finishRun(run: PipelineRun): PipelineRun {
  run.completedAt = new Date().toISOString();
  run.duration = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();

  state.isRunning = false;
  state.currentRun = null;
  state.history.unshift(run);

  if (state.history.length > 50) {
    state.history = state.history.slice(0, 50);
  }

  pipelineEvents.emit('complete', run);
  return run;
}

export function stopPipeline(): boolean {
  if (!state.isRunning || !state.currentRun) return false;

  state.currentRun.status = 'failed';
  state.currentRun.error = 'Manually stopped';
  finishRun(state.currentRun);
  return true;
}

/**
 * Rollback to a specific commit
 */
export function rollbackToCommit(projectRoot: string, commitHash: string): boolean {
  return rollback(projectRoot, commitHash);
}

/**
 * Auto-detect project and run pipeline
 */
export async function quickRun(projectRoot: string, apiKey?: string): Promise<PipelineRun> {
  let buildCommand = 'npm run build';
  let testCommand = 'npm test';

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.build) buildCommand = 'npm run build';
      if (pkg.scripts?.test) testCommand = 'npm test';
      if (pkg.scripts?.['test:unit']) testCommand = 'npm run test:unit';
    } catch {}
  }

  return runPipeline({
    projectRoot,
    buildCommand,
    testCommand,
    anthropicApiKey: apiKey,
    gitEnabled: true,
    gitCommitFixes: true,
  });
}
