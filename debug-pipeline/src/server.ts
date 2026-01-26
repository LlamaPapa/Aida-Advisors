/**
 * Debug Pipeline Server
 *
 * HTTP API for the debugging pipeline.
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

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

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

  const {
    projectRoot,
    buildCommand,
    testCommand,
    maxFixAttempts,
    autoFix,
    runTests,
    useClaudeCode,
    timeout,
  } = req.body;

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  // Start pipeline (don't await - return immediately)
  const runPromise = runPipeline({
    projectRoot,
    buildCommand,
    testCommand,
    maxFixAttempts: maxFixAttempts ?? 3,
    autoFix: autoFix ?? true,
    runTests: runTests ?? true,
    useClaudeCode: useClaudeCode ?? true,
    timeout: timeout ?? 300000,
  });

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

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\\ndata: ${JSON.stringify(data)}\\n\\n`);
  };

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

  req.on('close', () => {
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

app.listen(PORT, () => {
  console.log('');
  console.log('🔧 Debug Pipeline Server');
  console.log('========================');
  console.log(`Running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /api/run         - Start pipeline');
  console.log('  POST /api/quick-run   - Auto-detect and run');
  console.log('  POST /api/stop        - Stop current run');
  console.log('  GET  /api/state       - Get state');
  console.log('  GET  /api/history     - Get run history');
  console.log('  GET  /api/runs/:id    - Get specific run');
  console.log('  GET  /api/events      - SSE stream');
  console.log('');
});
