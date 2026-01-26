/**
 * Debug Pipeline Server
 *
 * HTTP API + Web Dashboard for the debugging pipeline.
 */

import { config } from 'dotenv';
config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  runPipeline,
  quickRun,
  stopPipeline,
  getState,
  getRun,
  getHistory,
  pipelineEvents,
} from './pipeline.js';
import type { PipelineConfig } from './types.js';
import { getDashboardHtml } from './dashboard.js';
import { AutoHook, createGitHook } from './autoHook.js';
import { verify } from './verificationAgent.js';
import { verifyAndFix, runAutoFix, autoFixEvents } from './autoFix.js';
import { exploreApp } from './explorer.js';
import {
  validateWebhookAuth,
  validateProjectRoot,
  validateUrl,
  validateInt,
  validateBool,
} from './security.js';

// Global auto-hook instance
let autoHook: AutoHook | null = null;

const app = express();
const PORT = process.env.PORT || 3020;

app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit request body size

// Webhook authentication middleware
const webhookAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (validateWebhookAuth(req.headers.authorization)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized - set UI_DEBUGGER_WEBHOOK_SECRET or provide Bearer token' });
  }
};

// === DASHBOARD ===
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getDashboardHtml());
});

// === API ROUTES ===

// Get pipeline state
app.get('/api/state', (req, res) => {
  res.json(getState());
});

// Get run history
app.get('/api/history', (req, res) => {
  res.json(getHistory());
});

// Get specific run
app.get('/api/runs/:runId', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
});

// Start a pipeline run
app.post('/api/run', async (req, res) => {
  const state = getState();
  if (state.isRunning) {
    res.status(409).json({ error: 'Pipeline is already running', currentRun: state.currentRun });
    return;
  }

  // Validate projectRoot
  const validProjectRoot = validateProjectRoot(req.body.projectRoot);
  if (!validProjectRoot) {
    res.status(400).json({ error: 'projectRoot is required and must be an absolute path' });
    return;
  }

  // Build config with validated values
  const pipelineConfig: PipelineConfig = { projectRoot: validProjectRoot };

  // Validate and sanitize optional fields
  if (typeof req.body.buildCommand === 'string') pipelineConfig.buildCommand = req.body.buildCommand.slice(0, 500);
  if (typeof req.body.testCommand === 'string') pipelineConfig.testCommand = req.body.testCommand.slice(0, 500);
  if (typeof req.body.lintCommand === 'string') pipelineConfig.lintCommand = req.body.lintCommand.slice(0, 500);
  pipelineConfig.maxFixAttempts = validateInt(req.body.maxFixAttempts, 0, 10, 3);
  pipelineConfig.autoFix = validateBool(req.body.autoFix, true);
  pipelineConfig.runLint = validateBool(req.body.runLint, false);  // Off by default - not all projects have lint
  pipelineConfig.runTests = validateBool(req.body.runTests, false);  // Off by default - detect automatically
  pipelineConfig.useClaudeCode = validateBool(req.body.useClaudeCode, true);
  pipelineConfig.timeout = validateInt(req.body.timeout, 10000, 600000, 300000);
  pipelineConfig.gitEnabled = validateBool(req.body.gitEnabled, true);
  pipelineConfig.gitCommitFixes = validateBool(req.body.gitCommitFixes, true);

  // Start pipeline (don't await - return immediately)
  const runPromise = runPipeline(pipelineConfig);

  // Get initial run info
  const currentState = getState();
  res.json({
    message: 'Pipeline started',
    runId: currentState.currentRun?.id,
    status: 'running',
  });

  // Let it complete in background
  runPromise.catch(console.error);
});

// Quick run - auto-detects project scripts
app.post('/api/quick-run', async (req, res) => {
  const state = getState();
  if (state.isRunning) {
    res.status(409).json({ error: 'Pipeline is already running' });
    return;
  }

  // Validate projectRoot - must be absolute path
  const validProjectRoot = validateProjectRoot(req.body.projectRoot);
  if (!validProjectRoot) {
    res.status(400).json({
      error: 'projectRoot is required and must be an absolute path (starting with /)',
      received: req.body.projectRoot
    });
    return;
  }

  const runPromise = quickRun(validProjectRoot);
  const currentState = getState();

  res.json({
    message: 'Pipeline started',
    runId: currentState.currentRun?.id,
  });

  runPromise.catch(console.error);
});

// Stop current run
app.post('/api/stop', (req, res) => {
  const stopped = stopPipeline();
  if (!stopped) {
    res.status(404).json({ error: 'No pipeline running' });
    return;
  }
  res.json({ success: true, message: 'Pipeline stopped' });
});

// === UI VERIFICATION ===
// This is the main feature: analyze code, generate tests, run them

app.post('/api/verify-ui', async (req, res) => {
  const validProjectRoot = validateProjectRoot(req.body.projectRoot);
  if (!validProjectRoot) {
    res.status(400).json({ error: 'projectRoot is required and must be an absolute path' });
    return;
  }

  const baseUrl = validateUrl(req.body.baseUrl);
  if (!baseUrl) {
    res.status(400).json({ error: 'baseUrl is required (e.g., http://localhost:5180)' });
    return;
  }

  console.log(`[verify-ui] Starting verification for ${validProjectRoot}`);
  console.log(`[verify-ui] Base URL: ${baseUrl}`);

  try {
    // Run full verification with UI tests
    const result = await verify({
      projectRoot: validProjectRoot,
      baseUrl,
      shouldRunUITests: true,
      sinceCommit: req.body.sinceCommit || 'HEAD~5',
      apiKey: process.env.ANTHROPIC_API_KEY,
      plan: req.body.plan, // Optional: pass a specific plan
    });

    console.log(`[verify-ui] Complete: ${result.status}`);
    console.log(`[verify-ui] Test plan: ${result.testPlan.scenarios.length} scenarios`);
    console.log(`[verify-ui] Flags: ${result.flags.length}`);

    res.json({
      success: result.status === 'pass' || result.status === 'partial',
      status: result.status,
      summary: result.summary,
      testPlan: result.testPlan,
      testResults: result.testResults,
      flags: result.flags,
      implementation: {
        filesCreated: result.implementation.filesCreated,
        filesModified: result.implementation.filesModified,
      },
      readyToContinue: result.readyToContinue,
    });
  } catch (error) {
    console.error('[verify-ui] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Verification failed',
    });
  }
});

// === EXPLORE MODE ===
// Just opens your app and clicks around to find bugs. No plans, no commits.

app.post('/api/explore', async (req, res) => {
  const baseUrl = validateUrl(req.body.baseUrl);
  if (!baseUrl) {
    res.status(400).json({ error: 'baseUrl is required (e.g., http://localhost:5180)' });
    return;
  }

  const maxActions = validateInt(req.body.maxActions, 5, 50, 15);

  console.log(`[explore] Starting exploration of ${baseUrl}`);
  console.log(`[explore] Max actions: ${maxActions}`);

  try {
    const result = await exploreApp({
      baseUrl,
      maxActions,
      apiKey: process.env.ANTHROPIC_API_KEY,
      headless: true,
    });

    console.log(`[explore] Complete: ${result.summary}`);

    res.json({
      success: result.success,
      summary: result.summary,
      actionsPerformed: result.actionsPerformed,
      errorsFound: result.errorsFound,
      consoleErrors: result.consoleErrors,
      actions: result.actions,
      screenshots: result.screenshots,
    });
  } catch (error) {
    console.error('[explore] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Exploration failed',
    });
  }
});

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial state
  sendEvent('state', getState());

  const onStart = (run: any) => sendEvent('start', run);
  const onStage = (data: any) => sendEvent('stage', data);
  const onLog = (data: any) => sendEvent('log', data);
  const onUpdate = (run: any) => sendEvent('update', run);
  const onComplete = (run: any) => sendEvent('complete', run);

  pipelineEvents.on('start', onStart);
  pipelineEvents.on('stage', onStage);
  pipelineEvents.on('log', onLog);
  pipelineEvents.on('update', onUpdate);
  pipelineEvents.on('complete', onComplete);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pipelineEvents.off('start', onStart);
    pipelineEvents.off('stage', onStage);
    pipelineEvents.off('log', onLog);
    pipelineEvents.off('update', onUpdate);
    pipelineEvents.off('complete', onComplete);
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// === AUTO-HOOK ENDPOINTS ===

// Start auto-hook monitoring
app.post('/api/hook/start', async (req, res) => {
  if (autoHook) {
    res.status(409).json({ error: 'Auto-hook already running' });
    return;
  }

  const { projectRoot, baseUrl, watchFiles, watchGit, roundtableUrl, runUITests } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  try {
    autoHook = new AutoHook({
      projectRoot,
      baseUrl,
      watchFiles: watchFiles !== false,
      watchGit: watchGit !== false,
      roundtableUrl,
      runUITests: runUITests !== false,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    await autoHook.start();

    res.json({
      success: true,
      message: 'Auto-hook started',
      watching: { files: watchFiles !== false, git: watchGit !== false },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Stop auto-hook monitoring
app.post('/api/hook/stop', (req, res) => {
  if (!autoHook) {
    res.status(404).json({ error: 'No auto-hook running' });
    return;
  }

  autoHook.stop();
  autoHook = null;

  res.json({ success: true, message: 'Auto-hook stopped' });
});

// Webhook for vibecoder-roundtable: implementation complete
// Protected by webhook auth (set UI_DEBUGGER_WEBHOOK_SECRET to enable)
app.post('/api/hook/implementation', webhookAuth, async (req, res) => {
  const { projectRoot, plan, sessionId, commitHash } = req.body;

  // Validate projectRoot
  const validProjectRoot = validateProjectRoot(projectRoot);
  if (!validProjectRoot) {
    res.status(400).json({ error: 'projectRoot is required and must be an absolute path' });
    return;
  }

  try {
    // If auto-hook is running, use it
    if (autoHook) {
      const result = await autoHook.handleWebhook({
        type: 'implementation-complete',
        projectRoot: validProjectRoot,
        plan,
        sessionId,
        commitHash,
      });

      res.json({
        success: result.success,
        verification: result.verification?.status,
        flags: result.verification?.flags,
        duration: result.duration,
      });
      return;
    }

    // Otherwise, run one-shot verification
    const result = await verify({
      projectRoot: validProjectRoot,
      plan,
      sinceCommit: commitHash || 'HEAD~1',
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    res.json({
      success: result.status === 'pass' || result.status === 'partial',
      verification: result.status,
      flags: result.flags,
      summary: result.summary,
      readyToContinue: result.readyToContinue,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Webhook for git commits (called by post-commit hook)
// Protected by webhook auth (set UI_DEBUGGER_WEBHOOK_SECRET to enable)
app.post('/api/hook/commit', webhookAuth, async (req, res) => {
  const { commitHash } = req.body;

  // Validate commit hash format if provided
  if (commitHash && !/^[a-f0-9]{7,40}$/i.test(commitHash)) {
    res.status(400).json({ error: 'Invalid commit hash format' });
    return;
  }

  if (autoHook) {
    const result = await autoHook.handleWebhook({
      type: 'code-generated',
      commitHash,
    });

    res.json({ success: result.success });
  } else {
    res.json({ success: false, message: 'Auto-hook not running' });
  }
});

// Setup git hook
app.post('/api/hook/setup-git', (req, res) => {
  const { projectRoot } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  const webhookUrl = `http://localhost:${PORT}`;
  const hookPath = createGitHook(projectRoot, webhookUrl);

  if (hookPath) {
    res.json({ success: true, hookPath });
  } else {
    res.status(400).json({ error: 'Could not create git hook - .git/hooks not found' });
  }
});

// Get auto-hook status
app.get('/api/hook/status', (req, res) => {
  res.json({
    running: !!autoHook,
  });
});

// === AUTO-FIX ENDPOINTS ===

// Verify and auto-fix in one call
app.post('/api/auto-fix', webhookAuth, async (req, res) => {
  const validProjectRoot = validateProjectRoot(req.body.projectRoot);
  if (!validProjectRoot) {
    res.status(400).json({ error: 'projectRoot is required and must be an absolute path' });
    return;
  }

  const baseUrl = validateUrl(req.body.baseUrl) || undefined;
  const maxAttempts = validateInt(req.body.maxAttempts, 1, 10, 3);
  const commitFixes = validateBool(req.body.commitFixes, false);

  try {
    const result = await verifyAndFix({
      projectRoot: validProjectRoot,
      baseUrl,
      plan: req.body.plan,
      maxAttempts,
      commitFixes,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    res.json({
      success: result.autoFix?.success ?? result.verification.status === 'pass',
      verification: {
        status: result.verification.status,
        flags: result.verification.flags,
        summary: result.verification.summary,
      },
      autoFix: result.autoFix ? {
        issuesFixed: result.autoFix.issuesFixed,
        issuesRemaining: result.autoFix.issuesRemaining,
        attempts: result.autoFix.attempts.length,
        commitHash: result.autoFix.commitHash,
        duration: result.autoFix.duration,
      } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// SSE stream for auto-fix progress
app.get('/api/auto-fix/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const handlers: Record<string, (...args: unknown[]) => void> = {
    start: (data) => {
      res.write(`data: ${JSON.stringify({ type: 'start', data })}\n\n`);
    },
    attemptStart: (data) => {
      res.write(`data: ${JSON.stringify({ type: 'attemptStart', data })}\n\n`);
    },
    attemptComplete: (data) => {
      res.write(`data: ${JSON.stringify({ type: 'attemptComplete', data })}\n\n`);
    },
    complete: (data) => {
      res.write(`data: ${JSON.stringify({ type: 'complete', data })}\n\n`);
    },
  };

  for (const [event, handler] of Object.entries(handlers)) {
    autoFixEvents.on(event, handler);
  }

  req.on('close', () => {
    for (const [event, handler] of Object.entries(handlers)) {
      autoFixEvents.off(event, handler);
    }
  });
});

// API 404 handler - must be after all /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

// Catch-all for SPA - return dashboard for non-API routes
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getDashboardHtml());
});

app.listen(PORT, () => {
  console.log('');
  console.log('🔧 Debug Pipeline Server');
  console.log('========================');
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log('');
  console.log('API Endpoints:');
  console.log('  POST /api/run              - Start pipeline');
  console.log('  POST /api/quick-run        - Auto-detect and run');
  console.log('  POST /api/stop             - Stop current run');
  console.log('  GET  /api/state            - Get state');
  console.log('  GET  /api/history          - Get run history');
  console.log('  GET  /api/runs/:id         - Get specific run');
  console.log('  GET  /api/events           - SSE stream');
  console.log('');
  console.log('Auto-Hook (for vibecoder integration):');
  console.log('  POST /api/hook/start       - Start auto-monitoring');
  console.log('  POST /api/hook/stop        - Stop auto-monitoring');
  console.log('  POST /api/hook/implementation - Webhook for vibecoder');
  console.log('  POST /api/hook/commit      - Git commit webhook');
  console.log('  POST /api/hook/setup-git   - Install git hook');
  console.log('  GET  /api/hook/status      - Check hook status');
  console.log('');
});
