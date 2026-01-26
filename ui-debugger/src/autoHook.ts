/**
 * Auto-Hook Module
 *
 * Automatically triggers UI testing after code implementation:
 * 1. Webhook endpoint for vibecoder-roundtable to call
 * 2. Git watcher for post-commit hooks
 * 3. File watcher for continuous integration
 *
 * This removes the need for manual CLI calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import { watch } from 'fs';
import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { verify, type ImplementationPlan, type VerificationResult } from './verificationAgent.js';
import { runPipeline } from './pipeline.js';

export interface AutoHookConfig {
  projectRoot: string;
  baseUrl?: string;
  apiKey?: string;
  roundtableUrl?: string;
  // Triggers
  watchFiles?: boolean;
  watchGit?: boolean;
  webhookPort?: number;
  // Behavior
  runUITests?: boolean;
  runBuildFix?: boolean;
  debounceMs?: number;
  // Callbacks
  onTrigger?: (trigger: TriggerEvent) => void;
  onComplete?: (result: HookResult) => void;
  onError?: (error: Error) => void;
}

export interface TriggerEvent {
  type: 'webhook' | 'git-commit' | 'file-change' | 'manual';
  source: string;
  timestamp: string;
  plan?: ImplementationPlan;
  commitHash?: string;
  changedFiles?: string[];
}

export interface HookResult {
  trigger: TriggerEvent;
  verification?: VerificationResult;
  buildResult?: { success: boolean; error?: string };
  duration: number;
  success: boolean;
}

export class AutoHook extends EventEmitter {
  private config: AutoHookConfig;
  private isRunning = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastCommitHash: string | null = null;
  private watchers: Array<() => void> = [];

  constructor(config: AutoHookConfig) {
    super();
    this.config = {
      debounceMs: 2000,
      runUITests: true,
      runBuildFix: true,
      ...config,
    };
  }

  /**
   * Start all configured watchers
   */
  async start(): Promise<void> {
    console.log('🔄 Auto-Hook starting...');
    console.log(`   Project: ${this.config.projectRoot}`);

    if (this.config.watchFiles) {
      this.startFileWatcher();
    }

    if (this.config.watchGit) {
      this.startGitWatcher();
    }

    console.log('✅ Auto-Hook active');
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    console.log('⏹️  Auto-Hook stopping...');
    this.watchers.forEach(cleanup => cleanup());
    this.watchers = [];

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  /**
   * Handle incoming webhook from vibecoder-roundtable
   */
  async handleWebhook(payload: {
    type: 'implementation-complete' | 'code-generated' | 'build-requested';
    projectRoot?: string;
    plan?: ImplementationPlan;
    sessionId?: string;
    commitHash?: string;
  }): Promise<HookResult> {
    const trigger: TriggerEvent = {
      type: 'webhook',
      source: payload.type,
      timestamp: new Date().toISOString(),
      plan: payload.plan,
      commitHash: payload.commitHash,
    };

    return this.runHook(trigger);
  }

  /**
   * Manually trigger the hook
   */
  async trigger(plan?: ImplementationPlan): Promise<HookResult> {
    const trigger: TriggerEvent = {
      type: 'manual',
      source: 'manual-trigger',
      timestamp: new Date().toISOString(),
      plan,
    };

    return this.runHook(trigger);
  }

  /**
   * Main hook execution
   */
  private async runHook(trigger: TriggerEvent): Promise<HookResult> {
    const startTime = Date.now();

    // Prevent concurrent runs
    if (this.isRunning) {
      console.log('⏳ Hook already running, queuing...');
      return new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.isRunning) {
            clearInterval(checkInterval);
            resolve(this.runHook(trigger));
          }
        }, 1000);
      });
    }

    this.isRunning = true;
    this.emit('trigger', trigger);
    this.config.onTrigger?.(trigger);

    console.log('\n' + '═'.repeat(60));
    console.log(`🚀 AUTO-HOOK TRIGGERED: ${trigger.type}`);
    console.log(`   Source: ${trigger.source}`);
    console.log(`   Time: ${trigger.timestamp}`);
    console.log('═'.repeat(60) + '\n');

    let result: HookResult = {
      trigger,
      duration: 0,
      success: false,
    };

    try {
      // Step 1: Run verification
      console.log('📋 Step 1: Running verification...');
      const verification = await verify({
        projectRoot: this.config.projectRoot,
        plan: trigger.plan,
        roundtableUrl: this.config.roundtableUrl,
        apiKey: this.config.apiKey,
        runUITests: this.config.runUITests && !!this.config.baseUrl,
        baseUrl: this.config.baseUrl,
        sinceCommit: trigger.commitHash || 'HEAD~1',
      });

      result.verification = verification;
      console.log(`   Status: ${verification.status}`);
      console.log(`   Flags: ${verification.flags.length}`);

      // Step 2: Run build/fix if needed
      if (this.config.runBuildFix && verification.status !== 'pass') {
        console.log('\n🔧 Step 2: Running build pipeline...');
        const pipelineResult = await runPipeline({
          projectRoot: this.config.projectRoot,
          anthropicApiKey: this.config.apiKey,
          autoFix: true,
          useClaudeCode: true,
          gitEnabled: true,
          onLog: msg => console.log(`   ${msg}`),
        });

        result.buildResult = {
          success: pipelineResult.success,
          error: pipelineResult.error,
        };
        console.log(`   Build: ${pipelineResult.success ? 'SUCCESS' : 'FAILED'}`);
      }

      // Determine overall success
      result.success = verification.status === 'pass' ||
        (verification.status === 'partial' && (result.buildResult?.success ?? true));

      result.duration = Date.now() - startTime;

      // Report results
      this.reportResults(result);

      this.emit('complete', result);
      this.config.onComplete?.(result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('❌ Hook failed:', err.message);

      this.emit('error', err);
      this.config.onError?.(err);

      result.duration = Date.now() - startTime;
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Report results to console and optionally back to roundtable
   */
  private async reportResults(result: HookResult): Promise<void> {
    console.log('\n' + '─'.repeat(60));
    console.log('HOOK RESULT');
    console.log('─'.repeat(60));

    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} Overall: ${result.success ? 'PASS' : 'FAIL'}`);
    console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (result.verification) {
      console.log(`   Verification: ${result.verification.status}`);
      if (result.verification.flags.length > 0) {
        console.log('   Flags:');
        result.verification.flags.slice(0, 5).forEach(f => {
          const emoji = { critical: '🔴', warning: '🟡', info: '🔵' }[f.severity];
          console.log(`      ${emoji} ${f.message}`);
        });
      }
    }

    if (result.buildResult) {
      console.log(`   Build: ${result.buildResult.success ? 'SUCCESS' : 'FAILED'}`);
      if (result.buildResult.error) {
        console.log(`   Error: ${result.buildResult.error}`);
      }
    }

    console.log('─'.repeat(60) + '\n');

    // Report back to roundtable if configured
    if (this.config.roundtableUrl) {
      try {
        await fetch(`${this.config.roundtableUrl}/api/debug/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger: result.trigger,
            success: result.success,
            verification: result.verification?.status,
            flags: result.verification?.flags,
            duration: result.duration,
          }),
        });
      } catch {
        // Silent fail for reporting
      }
    }
  }

  /**
   * Watch for file changes in src directory
   */
  private startFileWatcher(): void {
    const srcDir = path.join(this.config.projectRoot, 'src');
    const watchDir = fs.existsSync(srcDir) ? srcDir : this.config.projectRoot;

    console.log(`   Watching files: ${watchDir}`);

    const watcher = watch(watchDir, { recursive: true }, (event, filename) => {
      if (!filename) return;

      // Ignore non-source files
      if (
        filename.includes('node_modules') ||
        filename.includes('.git') ||
        filename.includes('dist') ||
        filename.endsWith('.map') ||
        filename.startsWith('.')
      ) {
        return;
      }

      // Debounce
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const trigger: TriggerEvent = {
          type: 'file-change',
          source: filename,
          timestamp: new Date().toISOString(),
          changedFiles: [filename],
        };

        console.log(`📝 File changed: ${filename}`);
        this.runHook(trigger);
      }, this.config.debounceMs);
    });

    this.watchers.push(() => watcher.close());
  }

  /**
   * Watch for git commits
   */
  private startGitWatcher(): void {
    console.log('   Watching git commits');

    // Get initial commit hash
    try {
      this.lastCommitHash = execSync('git rev-parse HEAD', {
        cwd: this.config.projectRoot,
        encoding: 'utf-8',
      }).trim();
    } catch {
      console.warn('   Warning: Could not get git commit hash');
      return;
    }

    // Poll for new commits (git hooks are harder to set up portably)
    const interval = setInterval(() => {
      try {
        const currentHash = execSync('git rev-parse HEAD', {
          cwd: this.config.projectRoot,
          encoding: 'utf-8',
        }).trim();

        if (currentHash !== this.lastCommitHash) {
          const previousHash = this.lastCommitHash;
          this.lastCommitHash = currentHash;

          // Get changed files
          let changedFiles: string[] = [];
          try {
            const diff = execSync(`git diff --name-only ${previousHash}..${currentHash}`, {
              cwd: this.config.projectRoot,
              encoding: 'utf-8',
            });
            changedFiles = diff.trim().split('\n').filter(Boolean);
          } catch {
            // Ignore
          }

          const trigger: TriggerEvent = {
            type: 'git-commit',
            source: `commit:${currentHash.slice(0, 7)}`,
            timestamp: new Date().toISOString(),
            commitHash: currentHash,
            changedFiles,
          };

          console.log(`📦 New commit detected: ${currentHash.slice(0, 7)}`);
          this.runHook(trigger);
        }
      } catch {
        // Silent fail for polling
      }
    }, 5000); // Check every 5 seconds

    this.watchers.push(() => clearInterval(interval));
  }
}

/**
 * Create a git post-commit hook script
 */
export function createGitHook(projectRoot: string, webhookUrl: string): string {
  const hookContent = `#!/bin/sh
# Auto-generated by ui-debugger
# Triggers verification after each commit

COMMIT_HASH=$(git rev-parse HEAD)
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD)

curl -s -X POST "${webhookUrl}/api/hook/commit" \\
  -H "Content-Type: application/json" \\
  -d "{\\"commitHash\\": \\"$COMMIT_HASH\\", \\"changedFiles\\": [\\"$(echo $CHANGED_FILES | tr '\\n' '","')\\"]}" \\
  > /dev/null 2>&1 &

exit 0
`;

  const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');

  // Only create if .git exists
  if (fs.existsSync(path.join(projectRoot, '.git', 'hooks'))) {
    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
    console.log(`Created git hook: ${hookPath}`);
    return hookPath;
  }

  return '';
}

/**
 * Express middleware for webhook endpoint
 */
export function createWebhookMiddleware(hook: AutoHook) {
  return async (req: any, res: any) => {
    try {
      const result = await hook.handleWebhook(req.body);
      res.json({
        success: result.success,
        duration: result.duration,
        verification: result.verification?.status,
        flags: result.verification?.flags?.length || 0,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * Quick start helper
 */
export async function startAutoHook(config: AutoHookConfig): Promise<AutoHook> {
  const hook = new AutoHook(config);
  await hook.start();
  return hook;
}
