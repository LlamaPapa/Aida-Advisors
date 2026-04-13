/**
 * Demand Agent HTTP API.
 *
 * POST /api/run             - start a run with a Brief body
 * POST /api/stop            - cancel the current run
 * GET  /api/state           - current state + stats
 * GET  /api/history         - last N completed runs
 * GET  /api/runs/:id        - specific run
 * GET  /api/events          - SSE stream of log/stage/iteration/complete events
 * GET  /api/health          - health check
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import express from 'express';
import cors from 'cors';
import {
  runAgent,
  stopAgent,
  getState,
  getRun,
  getHistory,
  agentEvents,
} from './agent.js';
import { Brief } from './types.js';

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/state', (_req, res) => {
  res.json(getState());
});

app.get('/api/history', (_req, res) => {
  res.json(getHistory());
});

app.get('/api/runs/:runId', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
});

app.post('/api/run', (req, res) => {
  const current = getState();
  if (current.isRunning) {
    res.status(409).json({ error: 'Agent is already running', currentRun: current.currentRun });
    return;
  }

  const body = req.body as {
    brief?: Brief;
    maxIterations?: number;
    validationThreshold?: number;
    minConfirmingSignals?: number;
    hypothesesPerRound?: number;
    maxTokens?: number;
  };

  if (!body?.brief?.goal || typeof body.brief.budget !== 'number') {
    res.status(400).json({ error: 'brief.goal (string) and brief.budget (number) are required' });
    return;
  }

  const runPromise = runAgent({
    brief: body.brief,
    maxIterations: body.maxIterations,
    validationThreshold: body.validationThreshold,
    minConfirmingSignals: body.minConfirmingSignals,
    hypothesesPerRound: body.hypothesesPerRound,
    maxTokens: body.maxTokens,
  });

  runPromise.catch((err) => console.error('Agent run failed:', err));

  const afterStart = getState();
  res.json({
    message: 'Agent started',
    runId: afterStart.currentRun?.id,
    status: afterStart.currentRun?.status ?? 'idle',
  });
});

app.post('/api/stop', (_req, res) => {
  const stopped = stopAgent();
  if (!stopped) {
    res.status(404).json({ error: 'No agent run in progress' });
    return;
  }
  res.json({ success: true, message: 'Cancellation requested. Loop will stop at next boundary.' });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('state', getState());

  const onStart = (run: unknown) => send('start', run);
  const onStage = (data: unknown) => send('stage', data);
  const onLog = (data: unknown) => send('log', data);
  const onIteration = (data: unknown) => send('iteration', data);
  const onUpdate = (run: unknown) => send('update', run);
  const onComplete = (run: unknown) => send('complete', run);

  agentEvents.on('start', onStart);
  agentEvents.on('stage', onStage);
  agentEvents.on('log', onLog);
  agentEvents.on('iteration', onIteration);
  agentEvents.on('update', onUpdate);
  agentEvents.on('complete', onComplete);

  req.on('close', () => {
    agentEvents.off('start', onStart);
    agentEvents.off('stage', onStage);
    agentEvents.off('log', onLog);
    agentEvents.off('iteration', onIteration);
    agentEvents.off('update', onUpdate);
    agentEvents.off('complete', onComplete);
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('');
  console.log('Demand Agent Server');
  console.log('===================');
  console.log(`Running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /api/run      - Start a run (body: { brief, ...config })');
  console.log('  POST /api/stop     - Cancel current run');
  console.log('  GET  /api/state    - Current state + stats');
  console.log('  GET  /api/history  - Recent runs');
  console.log('  GET  /api/runs/:id - Specific run');
  console.log('  GET  /api/events   - SSE stream');
  console.log('');
});
