/**
 * Git Integration
 *
 * Handles git operations for the debug pipeline:
 * - Snapshot before fix attempts
 * - Commit successful fixes
 * - Rollback failed fixes
 * - Track diffs
 */

import { execSync } from 'child_process';
import { escapeGitMessage } from './security.js';

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  hasChanges: boolean;
  changedFiles: string[];
}

export interface GitSnapshot {
  commitHash: string;
  branch: string;
  timestamp: string;
}

/**
 * Check if directory is a git repo and get status
 */
export function getGitStatus(cwd: string): GitStatus {
  try {
    // Check if it's a git repo
    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf-8', stdio: 'pipe' });

    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const statusOutput = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' });
    const changedFiles = statusOutput
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3).trim());

    return {
      isRepo: true,
      branch: branch || 'HEAD',
      hasChanges: changedFiles.length > 0,
      changedFiles,
    };
  } catch {
    return {
      isRepo: false,
      branch: '',
      hasChanges: false,
      changedFiles: [],
    };
  }
}

/**
 * Create a snapshot (stash or commit) before making changes
 */
export function createSnapshot(cwd: string): GitSnapshot | null {
  try {
    const status = getGitStatus(cwd);
    if (!status.isRepo) return null;

    const commitHash = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

    return {
      commitHash,
      branch: status.branch,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Get diff of changes since last snapshot
 */
export function getDiff(cwd: string): string {
  try {
    // Get both staged and unstaged changes
    const diff = execSync('git diff HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 });
    return diff || '(no changes)';
  } catch {
    return '(failed to get diff)';
  }
}

/**
 * Get list of changed files since snapshot
 */
export function getChangedFiles(cwd: string): string[] {
  try {
    const output = execSync('git diff HEAD --name-only', { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Stage and commit all changes
 */
export function commitChanges(cwd: string, message: string): string | null {
  try {
    // Escape the message to prevent shell injection
    const safeMessage = escapeGitMessage(message);
    execSync('git add -A', { cwd, stdio: 'pipe' });
    execSync(`git commit -m "${safeMessage}"`, { cwd, stdio: 'pipe' });
    const hash = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    return hash;
  } catch {
    return null;
  }
}

/**
 * Rollback to a previous commit (hard reset)
 */
export function rollback(cwd: string, commitHash: string): boolean {
  try {
    // Validate commit hash format (40 hex chars or short hash 7-40 chars)
    if (!/^[a-f0-9]{7,40}$/i.test(commitHash)) {
      console.warn('[Git] Invalid commit hash format:', commitHash);
      return false;
    }
    execSync(`git reset --hard ${commitHash}`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Discard all uncommitted changes
 */
export function discardChanges(cwd: string): boolean {
  try {
    execSync('git checkout -- .', { cwd, stdio: 'pipe' });
    execSync('git clean -fd', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a fix branch
 */
export function createFixBranch(cwd: string, prefix: string, attempt: number): string | null {
  try {
    const timestamp = Date.now();
    const branchName = `${prefix}/fix-attempt-${attempt}-${timestamp}`;
    execSync(`git checkout -b "${branchName}"`, { cwd, stdio: 'pipe' });
    return branchName;
  } catch {
    return null;
  }
}

/**
 * Switch back to original branch
 */
export function switchBranch(cwd: string, branch: string): boolean {
  try {
    execSync(`git checkout "${branch}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
