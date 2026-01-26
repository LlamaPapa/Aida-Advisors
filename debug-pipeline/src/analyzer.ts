/**
 * Claude Opus 4.5 Analyzer
 *
 * Analyzes build/test failures and generates fix strategies.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DebugAnalysis } from './types.js';

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
 * Analyze a failure using Claude Opus 4.5 with extended thinking
 */
export async function analyzeFailure(
  failureType: 'build' | 'test',
  errorLogs: string,
  apiKey?: string
): Promise<DebugAnalysis> {
  const anthropic = getClient(apiKey);

  const systemPrompt = `You are a debugging expert analyzing a ${failureType} failure.

Generate hypotheses about what went wrong and suggest a strategy.

Respond in JSON only:
{
  "hypotheses": [
    {
      "probability": "high|medium|low",
      "category": "syntax|import|type|config|dependency|logic|runtime",
      "description": "What might be wrong",
      "suggestedFix": "How to fix it",
      "affectedFiles": ["optional", "list", "of", "files"]
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
${errorLogs.slice(-4000)}

Analyze this failure and provide hypotheses. Be specific about file names and line numbers if visible in the logs.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 8000,
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
 * Generate a fix prompt from analysis
 */
export async function generateFixPrompt(
  projectRoot: string,
  errorLogs: string,
  analysis: DebugAnalysis,
  apiKey?: string
): Promise<string> {
  const anthropic = getClient(apiKey);

  const systemPrompt = `You are a debugging assistant. Generate a clear, actionable prompt for Claude Code to fix this error.

The prompt should:
1. Clearly state what's broken
2. Include the specific error message
3. Reference the affected files
4. Give clear instructions on what to fix
5. Be concise but complete

Output ONLY the prompt text, nothing else.`;

  const userPrompt = `PROJECT: ${projectRoot}

ERROR LOGS (last 2000 chars):
${errorLogs.slice(-2000)}

ANALYSIS:
- Root cause: ${analysis.rootCause?.description || 'Unknown'}
- Affected files: ${analysis.affectedFiles.join(', ') || 'Unknown'}
- Top hypothesis: ${analysis.hypotheses[0]?.description || 'Unknown'}
- Suggested fix: ${analysis.hypotheses[0]?.suggestedFix || 'Unknown'}

Generate a prompt for Claude Code to fix this issue.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : createFallbackPrompt(projectRoot, errorLogs, analysis);
  } catch {
    return createFallbackPrompt(projectRoot, errorLogs, analysis);
  }
}

function createDefaultAnalysis(errorLogs: string): DebugAnalysis {
  // Extract file paths from error logs
  const fileMatches = errorLogs.match(/[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx):\d+/g) || [];
  const files = [...new Set(fileMatches.map(m => m.split(':')[0]))];

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

function createFallbackPrompt(projectRoot: string, errorLogs: string, analysis: DebugAnalysis): string {
  return `Fix the following error in ${projectRoot}:

${errorLogs.slice(-1500)}

Affected files: ${analysis.affectedFiles.join(', ') || 'See error above'}

Root cause: ${analysis.rootCause?.description || 'See error above'}

Please fix this issue.`;
}
