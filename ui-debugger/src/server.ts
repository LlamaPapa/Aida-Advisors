/**
 * Debug Pipeline Server
 *
 * HTTP API + Web Dashboard for the debugging pipeline.
 */

import { config } from 'dotenv';
config();

import express from 'express';
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
import { getDashboardHtml } from './dashboard.js';
import { AutoHook, createGitHook } from './autoHook.js';
import { verify } from './verificationAgent.js';

// Global auto-hook instance
let autoHook: AutoHook | null = null;

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

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

  const { projectRoot } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  // Build config with only defined values (let pipeline use defaults)
  const pipelineConfig: any = { projectRoot };

  if (req.body.buildCommand) pipelineConfig.buildCommand = req.body.buildCommand;
  if (req.body.testCommand) pipelineConfig.testCommand = req.body.testCommand;
  if (req.body.lintCommand) pipelineConfig.lintCommand = req.body.lintCommand;
  if (req.body.maxFixAttempts !== undefined) pipelineConfig.maxFixAttempts = req.body.maxFixAttempts;
  if (req.body.autoFix !== undefined) pipelineConfig.autoFix = req.body.autoFix;
  if (req.body.runLint !== undefined) pipelineConfig.runLint = req.body.runLint;
  if (req.body.runTests !== undefined) pipelineConfig.runTests = req.body.runTests;
  if (req.body.useClaudeCode !== undefined) pipelineConfig.useClaudeCode = req.body.useClaudeCode;
  if (req.body.timeout !== undefined) pipelineConfig.timeout = req.body.timeout;
  if (req.body.gitEnabled !== undefined) pipelineConfig.gitEnabled = req.body.gitEnabled;
  if (req.body.gitCommitFixes !== undefined) pipelineConfig.gitCommitFixes = req.body.gitCommitFixes;

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

// Quick run
app.post('/api/quick-run', async (req, res) => {
  const state = getState();
  if (state.isRunning) {
    res.status(409).json({ error: 'Pipeline is already running' });
    return;
  }

  const { projectRoot } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  const runPromise = quickRun(projectRoot);
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
app.post('/api/hook/implementation', async (req, res) => {
  const { projectRoot, plan, sessionId, commitHash } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  try {
    // If auto-hook is running, use it
    if (autoHook) {
      const result = await autoHook.handleWebhook({
        type: 'implementation-complete',
        projectRoot,
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
      projectRoot,
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
app.post('/api/hook/commit', async (req, res) => {
  const { commitHash, changedFiles } = req.body;

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
