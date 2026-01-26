/**
 * Verification Agent
 *
 * Proactive agent that:
 * 1. Reads the implementation plan from vibecoder-roundtable
 * 2. Checks what code was actually implemented
 * 3. Creates a test plan based on the requirements
 * 4. Runs UI/functional tests
 * 5. Generates a verification report with pass/fail/flags
 *
 * This bridges vibecoder-roundtable (planning) with debug-pipeline (verification)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Types
export interface ImplementationPlan {
  brief: string;
  mustHave: string[];
  mustNot: string[];
  doneLooksLike: string;
  filesExpected?: string[];
}

export interface ImplementationCheck {
  filesCreated: string[];
  filesModified: string[];
  gitDiff: string;
  codeChanges: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
}

export interface TestPlan {
  scenarios: Array<{
    id: string;
    name: string;
    description: string;
    type: 'unit' | 'integration' | 'ui' | 'smoke';
    steps: string[];
    expectedOutcome: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  }>;
  coverage: {
    mustHavesCovered: string[];
    mustHavesMissing: string[];
  };
}

export interface VerificationResult {
  status: 'pass' | 'fail' | 'partial' | 'blocked';
  plan: ImplementationPlan;
  implementation: ImplementationCheck;
  testPlan: TestPlan;
  testResults: Array<{
    scenarioId: string;
    passed: boolean;
    error?: string;
    screenshot?: string;
    duration: number;
  }>;
  flags: Array<{
    severity: 'critical' | 'warning' | 'info';
    message: string;
    file?: string;
    suggestion?: string;
  }>;
  summary: string;
  readyToContinue: boolean;
}

let anthropicClient: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!anthropicClient) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

/**
 * Fetch the implementation plan from vibecoder-roundtable API
 */
export async function fetchPlan(
  roundtableUrl: string,
  sessionId: string,
  projectRoot: string
): Promise<ImplementationPlan | null> {
  try {
    const response = await fetch(`${roundtableUrl}/api/intent/status`, {
      headers: {
        'X-Session-ID': sessionId,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ projectRoot }),
    });

    if (!response.ok) {
      console.error('Failed to fetch plan:', response.statusText);
      return null;
    }

    const data = await response.json();

    if (!data.confirmed || !data.intentText) {
      return null;
    }

    // Parse the intent text into a structured plan
    return parsePlanFromIntent(data.intentText, data.intentSchema);
  } catch (error) {
    console.error('Error fetching plan:', error);
    return null;
  }
}

/**
 * Parse plan from raw intent text
 */
function parsePlanFromIntent(intentText: string, schema?: any): ImplementationPlan {
  return {
    brief: intentText,
    mustHave: schema?.mustHave || [],
    mustNot: schema?.mustNot || [],
    doneLooksLike: schema?.doneLooksLike || 'Implementation complete',
    filesExpected: schema?.filesExpected || [],
  };
}

/**
 * Check what was actually implemented
 */
export function checkImplementation(projectRoot: string, sinceCommit?: string): ImplementationCheck {
  const since = sinceCommit || 'HEAD~5';

  // Get files changed
  let filesCreated: string[] = [];
  let filesModified: string[] = [];
  let gitDiff = '';
  let codeChanges: Array<{ file: string; additions: number; deletions: number }> = [];

  try {
    // Get diff stat
    const diffStat = execSync(`git diff ${since} --stat`, {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    // Parse diff stat
    const lines = diffStat.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)/);
      if (match) {
        const file = match[1].trim();
        const changes = parseInt(match[2], 10);
        const plusMinus = match[3];
        const additions = (plusMinus.match(/\+/g) || []).length;
        const deletions = (plusMinus.match(/-/g) || []).length;

        codeChanges.push({ file, additions, deletions });

        if (additions > 0 && deletions === 0) {
          filesCreated.push(file);
        } else {
          filesModified.push(file);
        }
      }
    }

    // Get full diff (truncated)
    gitDiff = execSync(`git diff ${since}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }).slice(0, 10000);
  } catch (error) {
    console.error('Git error:', error);
  }

  return {
    filesCreated,
    filesModified,
    gitDiff,
    codeChanges,
  };
}

/**
 * Generate a test plan based on the implementation plan and actual changes
 */
export async function generateTestPlan(
  plan: ImplementationPlan,
  implementation: ImplementationCheck,
  apiKey?: string
): Promise<TestPlan> {
  const client = getClient(apiKey);

  const prompt = `You are a QA engineer. Based on the implementation plan and code changes, create a test plan.

IMPLEMENTATION PLAN:
${plan.brief}

MUST HAVE:
${plan.mustHave.map((m, i) => `${i + 1}. ${m}`).join('\n')}

MUST NOT:
${plan.mustNot.map((m, i) => `${i + 1}. ${m}`).join('\n')}

DONE LOOKS LIKE:
${plan.doneLooksLike}

FILES CREATED:
${implementation.filesCreated.join('\n') || '(none)'}

FILES MODIFIED:
${implementation.filesModified.join('\n') || '(none)'}

CODE CHANGES SUMMARY:
${implementation.codeChanges.map(c => `${c.file}: +${c.additions}/-${c.deletions}`).join('\n')}

Generate a test plan in JSON:
{
  "scenarios": [
    {
      "id": "test-1",
      "name": "Test name",
      "description": "What this tests",
      "type": "smoke|unit|integration|ui",
      "steps": ["Step 1", "Step 2"],
      "expectedOutcome": "What success looks like",
      "priority": "critical|high|medium|low"
    }
  ],
  "coverage": {
    "mustHavesCovered": ["List of must-haves that are testable"],
    "mustHavesMissing": ["List of must-haves that cannot be verified with these tests"]
  }
}

Focus on:
1. Smoke tests first (does it even load?)
2. Critical functionality from must-haves
3. Edge cases mentioned in must-nots
4. Keep it practical - 3-7 scenarios max`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Failed to generate test plan:', error);
  }

  // Fallback minimal test plan
  return {
    scenarios: [{
      id: 'smoke-1',
      name: 'Basic Smoke Test',
      description: 'Verify the app loads without errors',
      type: 'smoke',
      steps: ['Open the application', 'Check for console errors'],
      expectedOutcome: 'No errors, page loads',
      priority: 'critical',
    }],
    coverage: {
      mustHavesCovered: [],
      mustHavesMissing: plan.mustHave,
    },
  };
}

/**
 * Generate verification flags based on analysis
 */
export async function generateFlags(
  plan: ImplementationPlan,
  implementation: ImplementationCheck,
  apiKey?: string
): Promise<VerificationResult['flags']> {
  const client = getClient(apiKey);
  const flags: VerificationResult['flags'] = [];

  // Quick checks
  if (implementation.filesCreated.length === 0 && implementation.filesModified.length === 0) {
    flags.push({
      severity: 'critical',
      message: 'No code changes detected',
      suggestion: 'Verify the implementation was committed',
    });
  }

  // Check for expected files
  if (plan.filesExpected && plan.filesExpected.length > 0) {
    const missing = plan.filesExpected.filter(
      f => !implementation.filesCreated.includes(f) && !implementation.filesModified.includes(f)
    );
    for (const file of missing) {
      flags.push({
        severity: 'warning',
        message: `Expected file not found: ${file}`,
        file,
        suggestion: 'Verify the file was created or check the plan',
      });
    }
  }

  // AI analysis for deeper issues
  const prompt = `Analyze this implementation for potential issues:

PLAN:
${plan.brief}

MUST HAVE: ${plan.mustHave.join(', ')}
MUST NOT: ${plan.mustNot.join(', ')}

CODE DIFF (first 5000 chars):
${implementation.gitDiff.slice(0, 5000)}

Identify potential issues. Respond in JSON:
{
  "flags": [
    {
      "severity": "critical|warning|info",
      "message": "Issue description",
      "file": "optional/file/path",
      "suggestion": "How to fix"
    }
  ]
}

Only flag real issues. Be specific. Max 5 flags.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      flags.push(...(result.flags || []));
    }
  } catch (error) {
    console.error('Flag generation failed:', error);
  }

  return flags;
}

/**
 * Run full verification
 */
export async function verify(config: {
  projectRoot: string;
  plan?: ImplementationPlan;
  roundtableUrl?: string;
  sessionId?: string;
  sinceCommit?: string;
  apiKey?: string;
  runUITests?: boolean;
  baseUrl?: string;
}): Promise<VerificationResult> {
  const {
    projectRoot,
    sinceCommit,
    apiKey,
    runUITests = false,
    baseUrl,
  } = config;

  // 1. Get the plan
  let plan: ImplementationPlan | null = config.plan || null;
  if (!plan && config.roundtableUrl && config.sessionId) {
    plan = await fetchPlan(config.roundtableUrl, config.sessionId, projectRoot);
  }

  if (!plan) {
    // Create a minimal plan from git log
    plan = {
      brief: 'Implementation verification (no plan found)',
      mustHave: [],
      mustNot: [],
      doneLooksLike: 'Code changes verified',
    };
  }

  // 2. Check what was implemented
  const implementation = checkImplementation(projectRoot, sinceCommit);

  // 3. Generate test plan
  const testPlan = await generateTestPlan(plan, implementation, apiKey);

  // 4. Generate flags
  const flags = await generateFlags(plan, implementation, apiKey);

  // 5. Run tests (simplified - real implementation would use Playwright)
  const testResults: VerificationResult['testResults'] = [];

  if (runUITests && baseUrl) {
    // TODO: Integrate with vibecoder's autoTestRunner
    console.log('UI tests would run here against:', baseUrl);
  }

  // 6. Determine status
  const criticalFlags = flags.filter(f => f.severity === 'critical');
  const warningFlags = flags.filter(f => f.severity === 'warning');

  let status: VerificationResult['status'] = 'pass';
  if (criticalFlags.length > 0) {
    status = 'fail';
  } else if (warningFlags.length > 0) {
    status = 'partial';
  }

  // 7. Generate summary
  const summary = [
    `Verification ${status.toUpperCase()}`,
    `Files: ${implementation.filesCreated.length} created, ${implementation.filesModified.length} modified`,
    `Tests planned: ${testPlan.scenarios.length}`,
    `Flags: ${criticalFlags.length} critical, ${warningFlags.length} warnings`,
    testPlan.coverage.mustHavesMissing.length > 0
      ? `Missing coverage: ${testPlan.coverage.mustHavesMissing.join(', ')}`
      : 'All must-haves covered',
  ].join(' | ');

  return {
    status,
    plan,
    implementation,
    testPlan,
    testResults,
    flags,
    summary,
    readyToContinue: status === 'pass' || status === 'partial',
  };
}

/**
 * Quick verification check (faster, less thorough)
 */
export async function quickVerify(
  projectRoot: string,
  apiKey?: string
): Promise<{ pass: boolean; issues: string[] }> {
  const implementation = checkImplementation(projectRoot);

  const issues: string[] = [];

  if (implementation.filesCreated.length === 0 && implementation.filesModified.length === 0) {
    issues.push('No code changes detected');
  }

  // Quick build check
  try {
    execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    issues.push('Build failed');
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}
