/**
 * Claude Opus 4.5 Analyzer
 *
 * Analyzes build/test failures and generates fix strategies.
 * Includes file context reading for better analysis.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { DebugAnalysis } from './types.js';
import { safeResolvePath } from './security.js';

let client: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!client) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY not set. Pass it via config or environment variable.');
    }
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

/**
 * Extract file paths from error logs
 */
export function extractFilePaths(errorLogs: string): string[] {
  const patterns = [
    // TypeScript/JavaScript errors: src/file.ts(10,5) or src/file.ts:10:5
    /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx))[\(:](\d+)/g,
    // General path patterns
    /(?:^|\s)((?:src|lib|app|components|pages|services|utils|hooks|types)\/[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx))/gm,
    // Error stack traces
    /at\s+.*?\(([^)]+\.(ts|tsx|js|jsx)):\d+:\d+\)/g,
  ];

  const files = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(errorLogs)) !== null) {
      const filePath = match[1];
      if (filePath && !filePath.includes('node_modules')) {
        files.add(filePath);
      }
    }
  }

  return [...files];
}

/**
 * Read file content with line numbers
 */
export function readFileWithLines(
  projectRoot: string,
  filePath: string,
  maxLines = 200,
  focusLine?: number
): string | null {
  try {
    // Use safe path resolution to prevent traversal attacks
    const fullPath = safeResolvePath(filePath, projectRoot);
    if (!fullPath) {
      return null; // Path traversal attempted
    }

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // If we have a focus line, show context around it
    if (focusLine && focusLine > 0) {
      const contextRadius = Math.floor(maxLines / 2);
      const start = Math.max(0, focusLine - contextRadius);
      const end = Math.min(lines.length, focusLine + contextRadius);

      return lines
        .slice(start, end)
        .map((line, i) => {
          const lineNum = start + i + 1;
          const marker = lineNum === focusLine ? '>>>' : '   ';
          return `${marker}${lineNum.toString().padStart(4)}: ${line}`;
        })
        .join('\n');
    }

    // Otherwise, return first maxLines
    return lines
      .slice(0, maxLines)
      .map((line, i) => `${(i + 1).toString().padStart(4)}: ${line}`)
      .join('\n');
  } catch {
    return null;
  }
}

/**
 * Gather context from affected files
 */
export function gatherFileContext(
  projectRoot: string,
  errorLogs: string,
  maxFilesToRead = 5,
  maxCharsPerFile = 4000
): string {
  const files = extractFilePaths(errorLogs);

  if (files.length === 0) {
    return '(No source files identified in error logs)';
  }

  const context: string[] = [];
  let totalChars = 0;
  const maxTotalChars = 20000; // Keep context reasonable

  for (const file of files.slice(0, maxFilesToRead)) {
    if (totalChars > maxTotalChars) break;

    // Try to extract line number from error
    const lineMatch = errorLogs.match(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:(](\\d+)`));
    const focusLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

    const content = readFileWithLines(projectRoot, file, 150, focusLine);

    if (content) {
      const truncated = content.slice(0, maxCharsPerFile);
      context.push(`\n=== FILE: ${file} ===\n${truncated}${content.length > maxCharsPerFile ? '\n... (truncated)' : ''}`);
      totalChars += truncated.length;
    }
  }

  return context.length > 0
    ? context.join('\n')
    : '(Could not read source files)';
}

/**
 * Analyze a failure using Claude Opus 4.5 with extended thinking
 */
export async function analyzeFailure(
  failureType: 'build' | 'test',
  errorLogs: string,
  apiKey?: string,
  projectRoot?: string
): Promise<DebugAnalysis> {
  const anthropic = getClient(apiKey);

  // Gather file context if projectRoot provided
  const fileContext = projectRoot
    ? gatherFileContext(projectRoot, errorLogs)
    : '(No project root provided - working from error logs only)';

  const systemPrompt = `You are a debugging expert analyzing a ${failureType} failure.

You have access to:
1. Error logs from the build/test process
2. Source code from affected files (with line numbers)

Generate hypotheses about what went wrong and suggest a strategy.

Respond in JSON only:
{
  "hypotheses": [
    {
      "probability": "high|medium|low",
      "category": "syntax|import|type|config|dependency|logic|runtime",
      "description": "What might be wrong",
      "suggestedFix": "How to fix it - be specific with code changes",
      "affectedFiles": ["files", "to", "modify"]
    }
  ],
  "rootCause": {
    "file": "path/to/file.ts",
    "line": 42,
    "description": "The root cause",
    "confidence": 0.8
  },
  "affectedFiles": ["list", "of", "affected", "files"],
  "suggestedStrategy": "auto-fix|targeted-fix|rollback|manual|skip",
  "confidence": 0.7
}`;

  const userPrompt = `FAILURE TYPE: ${failureType}

ERROR LOGS:
${errorLogs.slice(-6000)}

SOURCE FILES:
${fileContext}

Analyze this failure. Look at both the error messages AND the source code to understand what's wrong. Be specific about fixes.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 10000,
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract content
    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content = block.text;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return createDefaultAnalysis(errorLogs);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      hypotheses: parsed.hypotheses || [],
      rootCause: parsed.rootCause,
      affectedFiles: parsed.affectedFiles || [],
      suggestedStrategy: parsed.suggestedStrategy || 'manual',
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    console.error('Analysis failed:', error);
    return createDefaultAnalysis(errorLogs);
  }
}

/**
 * Generate a fix prompt from analysis - now includes file context
 */
export async function generateFixPrompt(
  projectRoot: string,
  errorLogs: string,
  analysis: DebugAnalysis,
  apiKey?: string
): Promise<string> {
  const anthropic = getClient(apiKey);

  // Read the affected files for context
  const fileContext = gatherFileContext(projectRoot, errorLogs, 3, 3000);

  const systemPrompt = `You are a debugging assistant. Generate a clear, actionable prompt for Claude Code to fix this error.

The prompt should:
1. Clearly state what's broken with the specific error
2. Show the relevant code that needs to change
3. Give precise instructions on what to fix (line numbers, exact changes)
4. Be concise but complete enough that Claude Code can fix it without asking questions

Output ONLY the prompt text, nothing else.`;

  const userPrompt = `PROJECT: ${projectRoot}

ERROR LOGS:
${errorLogs.slice(-3000)}

AFFECTED SOURCE CODE:
${fileContext}

ANALYSIS:
- Root cause: ${analysis.rootCause?.description || 'Unknown'}
- File: ${analysis.rootCause?.file || 'See error'}
- Line: ${analysis.rootCause?.line || 'See error'}
- Top hypothesis: ${analysis.hypotheses[0]?.description || 'Unknown'}
- Suggested fix: ${analysis.hypotheses[0]?.suggestedFix || 'Unknown'}
- Confidence: ${analysis.confidence}

Generate a prompt for Claude Code to fix this issue. Include the specific code changes needed.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : createFallbackPrompt(projectRoot, errorLogs, analysis, fileContext);
  } catch {
    return createFallbackPrompt(projectRoot, errorLogs, analysis, fileContext);
  }
}

function createDefaultAnalysis(errorLogs: string): DebugAnalysis {
  const files = extractFilePaths(errorLogs);

  return {
    hypotheses: [{
      probability: 'medium',
      category: 'syntax',
      description: 'Unable to parse specific error. Manual investigation needed.',
      suggestedFix: 'Review the error logs and fix the identified issues.',
      affectedFiles: files,
    }],
    rootCause: {
      description: 'Could not determine specific root cause from logs.',
      confidence: 0.3,
    },
    affectedFiles: files,
    suggestedStrategy: 'manual',
    confidence: 0.3,
  };
}

function createFallbackPrompt(
  projectRoot: string,
  errorLogs: string,
  analysis: DebugAnalysis,
  fileContext: string
): string {
  return `Fix the following error in ${projectRoot}:

ERROR:
${errorLogs.slice(-2000)}

RELEVANT CODE:
${fileContext.slice(0, 4000)}

Root cause: ${analysis.rootCause?.description || 'See error above'}
Affected files: ${analysis.affectedFiles.join(', ') || 'See error above'}
Suggested fix: ${analysis.hypotheses[0]?.suggestedFix || 'Fix the error shown above'}

Please fix this issue. Make the minimal changes necessary.`;
}
