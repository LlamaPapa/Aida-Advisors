#!/usr/bin/env node
/**
 * UI Debugger MCP Server
 *
 * Exposes UI debugging capabilities via Model Context Protocol.
 * Any MCP-compatible tool (Claude Code, Cursor, etc.) can use this.
 *
 * Usage:
 *   claude mcp add ui-debugger -- npx ui-debugger-mcp
 *
 * Tools exposed:
 *   - ui_debugger_verify: Test an implementation
 *   - ui_debugger_get_issues: Get current issues
 *   - ui_debugger_suggest_fixes: Get fix suggestions
 *   - ui_debugger_status: Check debugger status
 */

import { config } from 'dotenv';
config();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { verify, VerificationResult } from './verificationAgent.js';
import { runPipeline, getState, getHistory } from './pipeline.js';

// ============================================================================
// STANDARD DOCUMENT FORMAT
// ============================================================================

/**
 * Standard format for describing what was implemented.
 * Any tool can produce this, UI debugger will test it.
 */
const ImplementationDocSchema = z.object({
  // What was built
  summary: z.string().describe('Brief description of what was implemented'),
  intent: z.string().optional().describe('Original intent/request'),

  // Files involved
  filesCreated: z.array(z.string()).default([]).describe('New files created'),
  filesModified: z.array(z.string()).default([]).describe('Existing files modified'),

  // Expected behavior
  expectedBehavior: z.string().optional().describe('What should happen when it works'),
  mustHave: z.array(z.string()).default([]).describe('Required behaviors'),
  mustNot: z.array(z.string()).default([]).describe('Behaviors that must NOT occur'),

  // Context
  projectRoot: z.string().describe('Absolute path to project root'),
  baseUrl: z.string().optional().describe('URL to test against (for UI tests)'),

  // Optional metadata
  author: z.string().optional().describe('Tool/person that created this'),
  timestamp: z.string().optional().describe('When implementation completed'),
});

type ImplementationDoc = z.infer<typeof ImplementationDocSchema>;

/**
 * Standard format for issues found.
 * UI debugger produces this, any tool can consume it.
 */
interface IssueDoc {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'test_failure' | 'ui_bug' | 'missing_behavior' | 'unexpected_behavior' | 'performance';
  summary: string;
  details: string;
  file?: string;
  line?: number;
  screenshot?: string;
  suggestedFix?: string;
}

interface VerifyResultDoc {
  success: boolean;
  summary: string;
  issues: IssueDoc[];
  testsPassed: string[];
  testsFailed: string[];
  duration: number;
}

// ============================================================================
// STATE
// ============================================================================

let lastVerifyResult: VerifyResultDoc | null = null;
let currentImplementationDoc: ImplementationDoc | null = null;

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'ui-debugger',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ============================================================================
// TOOLS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'ui_debugger_verify',
        description: `Test an implementation and find issues.

Pass a document describing what you built, and UI debugger will:
1. Read the code and documentation
2. Generate test scenarios
3. Run UI tests (if baseUrl provided)
4. Return any issues found

This is the main entry point - call this after you finish implementing something.`,
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Brief description of what was implemented',
            },
            intent: {
              type: 'string',
              description: 'Original intent/request (optional)',
            },
            filesCreated: {
              type: 'array',
              items: { type: 'string' },
              description: 'New files created',
            },
            filesModified: {
              type: 'array',
              items: { type: 'string' },
              description: 'Existing files modified',
            },
            expectedBehavior: {
              type: 'string',
              description: 'What should happen when it works',
            },
            mustHave: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required behaviors that MUST work',
            },
            mustNot: {
              type: 'array',
              items: { type: 'string' },
              description: 'Behaviors that must NOT occur',
            },
            projectRoot: {
              type: 'string',
              description: 'Absolute path to project root',
            },
            baseUrl: {
              type: 'string',
              description: 'URL to test against (for UI tests)',
            },
          },
          required: ['summary', 'projectRoot'],
        },
      },
      {
        name: 'ui_debugger_get_issues',
        description: `Get the issues from the last verification run.

Returns detailed information about each issue found, including:
- Severity and type
- Description and details
- File/line if applicable
- Suggested fixes`,
        inputSchema: {
          type: 'object',
          properties: {
            severity: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low', 'all'],
              description: 'Filter by severity (default: all)',
            },
          },
        },
      },
      {
        name: 'ui_debugger_suggest_fixes',
        description: `Get AI-generated fix suggestions for issues found.

Analyzes the issues and provides actionable fix suggestions with:
- What to change
- Where to change it
- Code snippets when possible`,
        inputSchema: {
          type: 'object',
          properties: {
            issueId: {
              type: 'string',
              description: 'Specific issue ID to get fixes for (optional, defaults to all)',
            },
          },
        },
      },
      {
        name: 'ui_debugger_status',
        description: `Check the current status of UI debugger.

Returns:
- Whether a verification is running
- Last run results summary
- System health`,
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'ui_debugger_run_pipeline',
        description: `Run the full debug pipeline on a project.

This runs: build → test → analyze → fix (if enabled).
More comprehensive than verify, includes auto-fix attempts.`,
        inputSchema: {
          type: 'object',
          properties: {
            projectRoot: {
              type: 'string',
              description: 'Absolute path to project root',
            },
            buildCommand: {
              type: 'string',
              description: 'Build command (auto-detected if not provided)',
            },
            testCommand: {
              type: 'string',
              description: 'Test command (auto-detected if not provided)',
            },
            autoFix: {
              type: 'boolean',
              description: 'Attempt to auto-fix issues (default: false)',
            },
            maxFixAttempts: {
              type: 'number',
              description: 'Max fix attempts (default: 3)',
            },
          },
          required: ['projectRoot'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: unknown } }) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'ui_debugger_verify': {
      const doc = ImplementationDocSchema.parse(args);
      currentImplementationDoc = doc;

      try {
        const result = await verify({
          projectRoot: doc.projectRoot,
          plan: {
            brief: doc.summary,
            mustHave: doc.mustHave,
            mustNot: doc.mustNot,
            doneLooksLike: doc.expectedBehavior || 'Feature works as expected',
          },
          baseUrl: doc.baseUrl,
          filesCreated: doc.filesCreated,
          filesModified: doc.filesModified,
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        // Transform to standard format
        const issues: IssueDoc[] = (result.flags || []).map((flag, i) => ({
          id: `issue-${i + 1}`,
          severity: mapSeverity(flag.severity),
          type: 'test_failure' as const,
          summary: flag.message,
          details: flag.message,
          file: flag.file,
          suggestedFix: flag.suggestion,
        }));

        lastVerifyResult = {
          success: result.status === 'pass',
          summary: result.summary,
          issues,
          testsPassed: result.testResults?.filter(t => t.passed).map(t => t.scenarioId) || [],
          testsFailed: result.testResults?.filter(t => !t.passed).map(t => t.scenarioId) || [],
          duration: 0,
        };

        return {
          content: [
            {
              type: 'text',
              text: formatVerifyResult(lastVerifyResult),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Verification failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case 'ui_debugger_get_issues': {
      if (!lastVerifyResult) {
        return {
          content: [
            {
              type: 'text',
              text: 'No verification has been run yet. Call ui_debugger_verify first.',
            },
          ],
        };
      }

      const severity = (args as { severity?: string })?.severity || 'all';
      let issues = lastVerifyResult.issues;

      if (severity !== 'all') {
        issues = issues.filter((i) => i.severity === severity);
      }

      return {
        content: [
          {
            type: 'text',
            text: formatIssues(issues),
          },
        ],
      };
    }

    case 'ui_debugger_suggest_fixes': {
      if (!lastVerifyResult || lastVerifyResult.issues.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No issues to fix. Either run verification first or all tests passed.',
            },
          ],
        };
      }

      const { issueId } = (args as { issueId?: string }) || {};
      const issues = issueId
        ? lastVerifyResult.issues.filter((i) => i.id === issueId)
        : lastVerifyResult.issues;

      const fixes = issues.map((issue) => ({
        issueId: issue.id,
        issue: issue.summary,
        suggestedFix: issue.suggestedFix || generateBasicFix(issue),
      }));

      return {
        content: [
          {
            type: 'text',
            text: formatFixes(fixes),
          },
        ],
      };
    }

    case 'ui_debugger_status': {
      const state = getState();
      const history = getHistory();

      return {
        content: [
          {
            type: 'text',
            text: formatStatus(state, history, lastVerifyResult),
          },
        ],
      };
    }

    case 'ui_debugger_run_pipeline': {
      const { projectRoot, buildCommand, testCommand, autoFix, maxFixAttempts } = (args as {
        projectRoot: string;
        buildCommand?: string;
        testCommand?: string;
        autoFix?: boolean;
        maxFixAttempts?: number;
      }) || {};

      if (!projectRoot) {
        return {
          content: [{ type: 'text', text: 'projectRoot is required' }],
          isError: true,
        };
      }

      try {
        const result = await runPipeline({
          projectRoot,
          buildCommand,
          testCommand,
          autoFix: autoFix ?? false,
          maxFixAttempts: maxFixAttempts ?? 3,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Pipeline ${result.success ? 'PASSED' : 'FAILED'}\n\n${result.summary}\n\nFix attempts: ${result.fixAttempts.length}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Pipeline failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
  }
});

// ============================================================================
// RESOURCES
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'ui-debugger://last-result',
        name: 'Last Verification Result',
        description: 'The full result from the last verification run',
        mimeType: 'application/json',
      },
      {
        uri: 'ui-debugger://implementation-doc',
        name: 'Current Implementation Doc',
        description: 'The implementation document being tested',
        mimeType: 'application/json',
      },
      {
        uri: 'ui-debugger://doc-format',
        name: 'Standard Document Format',
        description: 'The standard format for implementation documents',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
  const { uri } = request.params;

  switch (uri) {
    case 'ui-debugger://last-result':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(lastVerifyResult, null, 2),
          },
        ],
      };

    case 'ui-debugger://implementation-doc':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(currentImplementationDoc, null, 2),
          },
        ],
      };

    case 'ui-debugger://doc-format':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                description: 'Standard format for implementation documents',
                schema: {
                  summary: 'string (required) - Brief description of what was implemented',
                  intent: 'string - Original intent/request',
                  filesCreated: 'string[] - New files created',
                  filesModified: 'string[] - Existing files modified',
                  expectedBehavior: 'string - What should happen when it works',
                  mustHave: 'string[] - Required behaviors',
                  mustNot: 'string[] - Behaviors that must NOT occur',
                  projectRoot: 'string (required) - Absolute path to project',
                  baseUrl: 'string - URL to test against for UI tests',
                },
                example: {
                  summary: 'Added user authentication with JWT',
                  intent: 'Users should be able to log in and stay logged in',
                  filesCreated: ['src/auth/login.ts', 'src/auth/jwt.ts'],
                  filesModified: ['src/app.ts', 'src/routes/index.ts'],
                  expectedBehavior: 'User can log in with email/password and receives a JWT token',
                  mustHave: ['Login form works', 'JWT token is returned', 'Invalid credentials show error'],
                  mustNot: ['Passwords stored in plain text', 'Token exposed in URL'],
                  projectRoot: '/home/user/my-app',
                  baseUrl: 'http://localhost:3000',
                },
              },
              null,
              2
            ),
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ============================================================================
// HELPERS
// ============================================================================

function mapSeverity(severity: 'critical' | 'warning' | 'info'): IssueDoc['severity'] {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'high';
    case 'info':
      return 'low';
    default:
      return 'medium';
  }
}

function formatVerifyResult(result: VerifyResultDoc): string {
  const lines: string[] = [];

  lines.push(`# Verification ${result.success ? 'PASSED ✓' : 'FAILED ✗'}`);
  lines.push('');
  lines.push(result.summary);
  lines.push('');

  if (result.testsPassed.length > 0) {
    lines.push(`## Tests Passed (${result.testsPassed.length})`);
    result.testsPassed.forEach((t) => lines.push(`- ✓ ${t}`));
    lines.push('');
  }

  if (result.testsFailed.length > 0) {
    lines.push(`## Tests Failed (${result.testsFailed.length})`);
    result.testsFailed.forEach((t) => lines.push(`- ✗ ${t}`));
    lines.push('');
  }

  if (result.issues.length > 0) {
    lines.push(`## Issues Found (${result.issues.length})`);
    result.issues.forEach((issue) => {
      lines.push(`\n### [${issue.severity.toUpperCase()}] ${issue.summary}`);
      lines.push(issue.details);
      if (issue.file) lines.push(`File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
      if (issue.suggestedFix) lines.push(`\nSuggested fix: ${issue.suggestedFix}`);
    });
  }

  lines.push('');
  lines.push(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

  return lines.join('\n');
}

function formatIssues(issues: IssueDoc[]): string {
  if (issues.length === 0) {
    return 'No issues found.';
  }

  const lines: string[] = [`# Issues (${issues.length})`];

  for (const issue of issues) {
    lines.push('');
    lines.push(`## ${issue.id}: ${issue.summary}`);
    lines.push(`Severity: ${issue.severity} | Type: ${issue.type}`);
    lines.push('');
    lines.push(issue.details);
    if (issue.file) {
      lines.push(`\nLocation: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
    }
  }

  return lines.join('\n');
}

function formatFixes(fixes: { issueId: string; issue: string; suggestedFix: string }[]): string {
  const lines: string[] = ['# Suggested Fixes'];

  for (const fix of fixes) {
    lines.push('');
    lines.push(`## Fix for ${fix.issueId}`);
    lines.push(`Issue: ${fix.issue}`);
    lines.push('');
    lines.push(fix.suggestedFix);
  }

  return lines.join('\n');
}

interface PipelineState {
  isRunning: boolean;
  stats?: {
    totalRuns: number;
    successfulRuns: number;
  };
}

interface HistoryEntry {
  success: boolean;
  projectId: string;
  fixAttempts?: unknown[];
}

function formatStatus(state: PipelineState, history: HistoryEntry[], lastResult: VerifyResultDoc | null): string {
  const lines: string[] = ['# UI Debugger Status'];

  lines.push('');
  lines.push(`## Current State`);
  lines.push(`Running: ${state.isRunning ? 'Yes' : 'No'}`);
  lines.push(`Total runs: ${state.stats?.totalRuns || 0}`);
  lines.push(`Successful: ${state.stats?.successfulRuns || 0}`);

  if (lastResult) {
    lines.push('');
    lines.push(`## Last Verification`);
    lines.push(`Result: ${lastResult.success ? 'PASSED' : 'FAILED'}`);
    lines.push(`Issues: ${lastResult.issues.length}`);
    lines.push(`Duration: ${(lastResult.duration / 1000).toFixed(1)}s`);
  }

  if (history.length > 0) {
    lines.push('');
    lines.push(`## Recent History`);
    history.slice(0, 5).forEach((run) => {
      lines.push(`- ${run.success ? '✓' : '✗'} ${run.projectId} (${run.fixAttempts?.length || 0} fixes)`);
    });
  }

  return lines.join('\n');
}

function generateBasicFix(issue: IssueDoc): string {
  switch (issue.type) {
    case 'test_failure':
      return `Review the test expectations and implementation. The test "${issue.summary}" is failing - check if the implementation matches the expected behavior.`;
    case 'ui_bug':
      return `Check the UI component for visual/interaction issues. Look for CSS problems, event handlers, or rendering conditions.`;
    case 'missing_behavior':
      return `The expected behavior is not implemented. Add the missing functionality as described.`;
    case 'unexpected_behavior':
      return `The code is doing something unexpected. Review the logic and add guards or fix the conditions.`;
    case 'performance':
      return `Profile the affected code path. Look for unnecessary re-renders, expensive computations, or inefficient data structures.`;
    default:
      return `Review the code related to this issue and fix accordingly.`;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UI Debugger MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
