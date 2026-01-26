/**
 * Auto-Fix Loop
 *
 * Takes issues found by verification and attempts to fix them automatically.
 * Uses Claude to analyze issues, generate fixes, and apply them.
 *
 * Flow:
 * 1. Get issues from verification
 * 2. For each issue, generate a fix using Claude
 * 3. Apply the fix (edit files)
 * 4. Re-verify
 * 5. If still failing, loop (up to maxAttempts)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { verify, VerificationResult } from './verificationAgent.js';
import { safeResolvePath, safeReadFile } from './security.js';
import { commitChanges, discardChanges, createSnapshot } from './git.js';

// Event emitter for progress updates
export const autoFixEvents = new EventEmitter();

let client: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!client) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required');
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

// ============================================================================
// TYPES
// ============================================================================

export interface Issue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface FixAttempt {
  attemptNumber: number;
  issue: Issue;
  analysis: string;
  fixApplied: string;
  filesChanged: string[];
  success: boolean;
  error?: string;
  duration: number;
}

export interface AutoFixResult {
  success: boolean;
  issuesFixed: number;
  issuesRemaining: number;
  attempts: FixAttempt[];
  finalVerification: VerificationResult | null;
  duration: number;
  commitHash?: string;
}

export interface AutoFixConfig {
  projectRoot: string;
  issues: Issue[];
  maxAttempts?: number;
  commitFixes?: boolean;
  apiKey?: string;
  baseUrl?: string;
  plan?: {
    brief: string;
    mustHave?: string[];
    mustNot?: string[];
    doneLooksLike?: string;
  };
}

// ============================================================================
// FIX GENERATION
// ============================================================================

/**
 * Generate a fix for an issue using Claude
 */
async function generateFix(
  issue: Issue,
  projectRoot: string,
  apiKey?: string
): Promise<{ analysis: string; edits: Array<{ file: string; content: string }> }> {
  const anthropic = getClient(apiKey);

  // Read the affected file if specified
  let fileContext = '';
  if (issue.file) {
    const content = safeReadFile(issue.file, projectRoot);
    if (content) {
      fileContext = `\n\nAffected file (${issue.file}):\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
    }
  }

  // Read related files (same directory)
  let relatedContext = '';
  if (issue.file) {
    const dir = path.dirname(issue.file);
    const safeDirPath = safeResolvePath(dir, projectRoot);
    if (safeDirPath && fs.existsSync(safeDirPath)) {
      try {
        const files = fs.readdirSync(safeDirPath).slice(0, 5);
        for (const f of files) {
          if (f !== path.basename(issue.file) && (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx'))) {
            const content = safeReadFile(path.join(dir, f), projectRoot);
            if (content && content.length < 3000) {
              relatedContext += `\n\nRelated file (${path.join(dir, f)}):\n\`\`\`\n${content}\n\`\`\``;
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }
  }

  const prompt = `You are a senior developer fixing a bug. Analyze this issue and provide an exact fix.

ISSUE:
- Severity: ${issue.severity}
- Message: ${issue.message}
${issue.file ? `- File: ${issue.file}` : ''}
${issue.line ? `- Line: ${issue.line}` : ''}
${issue.suggestion ? `- Suggestion: ${issue.suggestion}` : ''}
${fileContext}
${relatedContext}

Respond with a JSON object containing:
1. "analysis": Brief explanation of what's wrong and how to fix it (1-2 sentences)
2. "edits": Array of file edits, each with:
   - "file": relative path to file
   - "content": the COMPLETE new file content (not a diff)

Example response:
{
  "analysis": "The function is missing a null check before accessing the property.",
  "edits": [
    {
      "file": "src/utils.ts",
      "content": "// Complete file content here..."
    }
  ]
}

IMPORTANT:
- Provide the COMPLETE file content, not just the changed lines
- Make minimal changes - only fix the specific issue
- Preserve all existing functionality
- If the fix requires changes to multiple files, include all of them`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { analysis: 'Could not parse fix response', edits: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      analysis: parsed.analysis || 'No analysis provided',
      edits: Array.isArray(parsed.edits) ? parsed.edits : [],
    };
  } catch {
    return { analysis: 'Could not parse fix response', edits: [] };
  }
}

/**
 * Apply edits to files
 */
function applyEdits(
  edits: Array<{ file: string; content: string }>,
  projectRoot: string
): string[] {
  const changedFiles: string[] = [];

  for (const edit of edits) {
    const safePath = safeResolvePath(edit.file, projectRoot);
    if (!safePath) {
      console.warn(`[AutoFix] Skipping unsafe path: ${edit.file}`);
      continue;
    }

    try {
      // Create directory if needed
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write the file
      fs.writeFileSync(safePath, edit.content, 'utf-8');
      changedFiles.push(edit.file);
      console.log(`[AutoFix] Updated: ${edit.file}`);
    } catch (error) {
      console.error(`[AutoFix] Failed to write ${edit.file}:`, error);
    }
  }

  return changedFiles;
}

// ============================================================================
// MAIN AUTO-FIX LOOP
// ============================================================================

/**
 * Run the auto-fix loop
 */
export async function runAutoFix(config: AutoFixConfig): Promise<AutoFixResult> {
  const {
    projectRoot,
    issues,
    maxAttempts = 3,
    commitFixes = false,
    apiKey,
    baseUrl,
    plan,
  } = config;

  const startTime = Date.now();
  const attempts: FixAttempt[] = [];
  let remainingIssues = [...issues];
  let finalVerification: VerificationResult | null = null;

  autoFixEvents.emit('start', { issueCount: issues.length, maxAttempts });

  // Create git snapshot before starting
  const snapshot = createSnapshot(projectRoot);
  if (snapshot) {
    console.log(`[AutoFix] Created snapshot: ${snapshot.commitHash}`);
  }

  // Process issues by severity (critical first)
  remainingIssues.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });

  let attemptNumber = 0;

  while (remainingIssues.length > 0 && attemptNumber < maxAttempts) {
    attemptNumber++;
    const issue = remainingIssues[0];

    autoFixEvents.emit('attemptStart', { attemptNumber, issue, remaining: remainingIssues.length });
    console.log(`[AutoFix] Attempt ${attemptNumber}/${maxAttempts} for: ${issue.message}`);

    const attemptStart = Date.now();

    try {
      // Generate fix
      const { analysis, edits } = await generateFix(issue, projectRoot, apiKey);

      if (edits.length === 0) {
        attempts.push({
          attemptNumber,
          issue,
          analysis,
          fixApplied: 'No edits generated',
          filesChanged: [],
          success: false,
          error: 'Claude did not generate any file edits',
          duration: Date.now() - attemptStart,
        });
        remainingIssues.shift(); // Move on to next issue
        continue;
      }

      // Apply edits
      const changedFiles = applyEdits(edits, projectRoot);

      // Re-verify
      const verifyResult = await verify({
        projectRoot,
        plan: plan ? {
          brief: plan.brief,
          mustHave: plan.mustHave || [],
          mustNot: plan.mustNot || [],
          doneLooksLike: plan.doneLooksLike || 'Working correctly',
        } : undefined,
        baseUrl,
        apiKey,
      });

      // Check if this specific issue is fixed
      const issueStillExists = verifyResult.flags.some(
        f => f.message.toLowerCase().includes(issue.message.toLowerCase().slice(0, 50))
      );

      const success = !issueStillExists;

      attempts.push({
        attemptNumber,
        issue,
        analysis,
        fixApplied: edits.map(e => `${e.file}: ${e.content.length} chars`).join(', '),
        filesChanged: changedFiles,
        success,
        duration: Date.now() - attemptStart,
      });

      autoFixEvents.emit('attemptComplete', {
        attemptNumber,
        issue,
        success,
        changedFiles,
      });

      if (success) {
        console.log(`[AutoFix] ✓ Fixed: ${issue.message}`);
        remainingIssues.shift();
      } else {
        console.log(`[AutoFix] ✗ Still failing: ${issue.message}`);
        // If we've tried this issue multiple times, move on
        if (attempts.filter(a => a.issue.id === issue.id).length >= 2) {
          remainingIssues.shift();
        }
      }

      // Update remaining issues from verification
      if (verifyResult.flags.length === 0) {
        remainingIssues = [];
        finalVerification = verifyResult;
        break;
      }

      // Check if all original issues are fixed
      const originalIssueIds = new Set(issues.map(i => i.id));
      const stillFailing = verifyResult.flags.filter(f =>
        issues.some(i => f.message.toLowerCase().includes(i.message.toLowerCase().slice(0, 30)))
      );

      if (stillFailing.length === 0) {
        remainingIssues = [];
        finalVerification = verifyResult;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AutoFix] Error:`, message);

      attempts.push({
        attemptNumber,
        issue,
        analysis: 'Error during fix attempt',
        fixApplied: '',
        filesChanged: [],
        success: false,
        error: message,
        duration: Date.now() - attemptStart,
      });

      remainingIssues.shift(); // Move on
    }
  }

  // Final verification if we haven't done one recently
  if (!finalVerification) {
    try {
      finalVerification = await verify({
        projectRoot,
        plan: plan ? {
          brief: plan.brief,
          mustHave: plan.mustHave || [],
          mustNot: plan.mustNot || [],
          doneLooksLike: plan.doneLooksLike || 'Working correctly',
        } : undefined,
        baseUrl,
        apiKey,
      });
    } catch {
      // Continue without final verification
    }
  }

  const issuesFixed = issues.length - remainingIssues.length;
  const success = remainingIssues.length === 0 || (finalVerification?.status === 'pass');

  // Commit fixes if requested and successful
  let commitHash: string | undefined;
  if (commitFixes && issuesFixed > 0) {
    const message = `Auto-fix: resolved ${issuesFixed} issue(s)\n\n${attempts.filter(a => a.success).map(a => `- ${a.issue.message}`).join('\n')}`;
    commitHash = commitChanges(projectRoot, message) || undefined;
    if (commitHash) {
      console.log(`[AutoFix] Committed fixes: ${commitHash}`);
    }
  }

  const result: AutoFixResult = {
    success,
    issuesFixed,
    issuesRemaining: remainingIssues.length,
    attempts,
    finalVerification,
    duration: Date.now() - startTime,
    commitHash,
  };

  autoFixEvents.emit('complete', result);

  return result;
}

/**
 * Quick fix - verify and auto-fix in one call
 */
export async function verifyAndFix(config: {
  projectRoot: string;
  baseUrl?: string;
  plan?: AutoFixConfig['plan'];
  maxAttempts?: number;
  commitFixes?: boolean;
  apiKey?: string;
}): Promise<{
  verification: VerificationResult;
  autoFix: AutoFixResult | null;
}> {
  const { projectRoot, baseUrl, plan, maxAttempts = 3, commitFixes = false, apiKey } = config;

  // First verify
  const verification = await verify({
    projectRoot,
    plan: plan ? {
      brief: plan.brief,
      mustHave: plan.mustHave || [],
      mustNot: plan.mustNot || [],
      doneLooksLike: plan.doneLooksLike || 'Working correctly',
    } : undefined,
    baseUrl,
    apiKey,
  });

  // If passing, no need to fix
  if (verification.status === 'pass') {
    return { verification, autoFix: null };
  }

  // Convert flags to issues
  const issues: Issue[] = verification.flags.map((flag, i) => ({
    id: `issue-${i + 1}`,
    severity: flag.severity === 'critical' ? 'critical' : flag.severity === 'warning' ? 'high' : 'medium',
    message: flag.message,
    file: flag.file,
    suggestion: flag.suggestion,
  }));

  // Run auto-fix
  const autoFix = await runAutoFix({
    projectRoot,
    issues,
    maxAttempts,
    commitFixes,
    apiKey,
    baseUrl,
    plan,
  });

  return { verification, autoFix };
}
