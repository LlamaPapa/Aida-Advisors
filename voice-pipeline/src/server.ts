import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWriteStream, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { VoiceConfig } from './types.js';
import { transcribe } from './transcriber.js';
import { structure } from './structurer.js';
import { copyToClipboard, autoPaste } from './clipboard.js';
import { getMemory, clearMemory } from './memory.js';
import { record } from './recorder.js';

const TEMP_DIR = join(tmpdir(), 'voice-pipeline');

function ensureTempDir(): void {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
}

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// ── State for daemon toggle ──────────────────────────────────
let recording = false;
let activeController: AbortController | null = null;

const WEB_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Voice</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif;
    background: #0a0a0a; color: #e0e0e0;
    height: 100dvh; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    -webkit-user-select: none; user-select: none;
    overflow: hidden;
  }
  #status { font-size: 14px; color: #888; margin-bottom: 24px; height: 20px; }
  #btn {
    width: 120px; height: 120px; border-radius: 50%;
    border: 3px solid #333; background: #1a1a1a;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  #btn:active, #btn.recording { background: #dc2626; border-color: #ef4444; transform: scale(1.05); }
  #btn.recording { animation: pulse 1.5s ease-in-out infinite; }
  #btn.processing { background: #1e40af; border-color: #3b82f6; pointer-events: none; }
  #btn svg { width: 48px; height: 48px; fill: #e0e0e0; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); } 50% { box-shadow: 0 0 0 20px rgba(220,38,38,0); } }
  #mode-row { margin-top: 32px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .mode-btn {
    padding: 6px 14px; border-radius: 20px; border: 1px solid #333;
    background: #1a1a1a; color: #aaa; font-size: 13px; cursor: pointer;
    transition: all 0.15s;
  }
  .mode-btn.active { border-color: #3b82f6; color: #fff; background: #1e3a5f; }
  #output {
    margin-top: 24px; padding: 16px; max-width: 90vw; width: 400px;
    max-height: 30vh; overflow-y: auto;
    background: #111; border: 1px solid #222; border-radius: 12px;
    font-size: 14px; line-height: 1.5; white-space: pre-wrap;
    display: none;
  }
  #output.show { display: block; }
  #copy-toast {
    position: fixed; bottom: 40px;
    background: #22c55e; color: #000; padding: 8px 20px;
    border-radius: 20px; font-size: 13px; font-weight: 600;
    opacity: 0; transition: opacity 0.3s;
  }
  #copy-toast.show { opacity: 1; }
  #memory-count { position: fixed; top: 16px; right: 16px; font-size: 12px; color: #555; }
</style>
</head>
<body>
  <div id="memory-count"></div>
  <div id="status">Tap to talk</div>
  <div id="btn" ontouchstart="" onclick="toggle()">
    <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>
  </div>
  <div id="mode-row"></div>
  <div id="output"></div>
  <div id="copy-toast">Copied!</div>
<script>
const modes = ['message','notes','email','code','tasks','raw'];
let mode = 'message';
let isRecording = false;
let mediaRecorder = null;
let chunks = [];

const btn = document.getElementById('btn');
const status = document.getElementById('status');
const output = document.getElementById('output');
const toast = document.getElementById('copy-toast');
const memCount = document.getElementById('memory-count');
const modeRow = document.getElementById('mode-row');

modes.forEach(m => {
  const b = document.createElement('div');
  b.className = 'mode-btn' + (m === mode ? ' active' : '');
  b.textContent = m;
  b.onclick = () => { mode = m; document.querySelectorAll('.mode-btn').forEach(x => x.classList.toggle('active', x.textContent === m)); };
  modeRow.appendChild(b);
});

async function toggle() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Prefer webm, fallback to mp4 for Safari
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); processAudio(); };
    mediaRecorder.start(100); // 100ms timeslice for responsiveness
    isRecording = true;
    btn.classList.add('recording');
    status.textContent = 'Listening...';
  } catch(e) {
    status.textContent = 'Mic access denied';
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  btn.classList.remove('recording');
  btn.classList.add('processing');
  status.textContent = 'Processing...';
}

async function processAudio() {
  try {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const form = new FormData();
    form.append('audio', blob, 'recording.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
    form.append('mode', mode);

    const res = await fetch('/api/process', { method: 'POST', body: form });
    const data = await res.json();

    if (data.error) {
      status.textContent = data.error;
      btn.classList.remove('processing');
      return;
    }

    output.textContent = data.structured;
    output.classList.add('show');

    // Auto-copy
    try {
      await navigator.clipboard.writeText(data.structured);
      showToast();
    } catch { /* clipboard may need gesture on iOS */ }

    status.textContent = 'Tap to talk';
    memCount.textContent = 'memory: ' + data.memorySize + '/10';
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
  }
  btn.classList.remove('processing');
}

function showToast() {
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1500);
}

// Keyboard shortcut: Option+Space (for desktop)
document.addEventListener('keydown', e => {
  if (e.altKey && e.code === 'Space') { e.preventDefault(); toggle(); }
});
</script>
</body>
</html>`;

export interface ServerConfig {
  port?: number;
  voiceConfig: VoiceConfig;
  onLog?: (msg: string) => void;
}

export function startServer(serverConfig: ServerConfig): void {
  const port = serverConfig.port || 7890;
  const config = serverConfig.voiceConfig;
  const log = serverConfig.onLog || console.log;

  ensureTempDir();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Web UI ──
    if (url.pathname === '/' && req.method === 'GET') {
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(WEB_UI);
      return;
    }

    // ── Process audio from browser ──
    if (url.pathname === '/api/process' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const boundary = getBoundary(req.headers['content-type'] || '');
        if (!boundary) { json(res, { error: 'Invalid multipart request' }, 400); return; }

        const parts = parseMultipart(body, boundary);
        const audioPart = parts.find(p => p.name === 'audio');
        const modePart = parts.find(p => p.name === 'mode');

        if (!audioPart) { json(res, { error: 'No audio data' }, 400); return; }

        const reqMode = modePart?.data.toString('utf-8') || config.mode || 'message';
        const ext = audioPart.filename?.split('.').pop() || 'webm';
        const tmpFile = join(TEMP_DIR, `upload-${Date.now()}.${ext}`);

        // Write audio to temp file for Whisper
        const ws = createWriteStream(tmpFile);
        ws.write(audioPart.data);
        ws.end();
        await new Promise<void>((resolve) => ws.on('finish', resolve));

        const transcription = await transcribe(tmpFile, config);

        // Clean up immediately
        try { unlinkSync(tmpFile); } catch {}

        if (!transcription.text.trim()) {
          json(res, { error: 'No speech detected' });
          return;
        }

        const structured = await structure(transcription.text, { ...config, mode: reqMode as VoiceConfig['mode'] });

        // Copy to clipboard on the server (for desktop use)
        await copyToClipboard(structured.structured);

        json(res, {
          raw: transcription.text,
          structured: structured.structured,
          mode: reqMode,
          memorySize: getMemory().length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Process error: ${msg}`);
        json(res, { error: msg }, 500);
      }
      return;
    }

    // ── Toggle recording (for Option+Space hotkey) ──
    if (url.pathname === '/api/toggle' && req.method === 'POST') {
      if (recording) {
        // Stop recording
        activeController?.abort();
        recording = false;
        json(res, { status: 'stopped' });
      } else {
        // Start recording
        recording = true;
        activeController = new AbortController();
        json(res, { status: 'recording' });

        // Process in background
        (async () => {
          try {
            const rec = await record(activeController!.signal);
            recording = false;
            log('Transcribing...');
            const transcription = await transcribe(rec.filePath, config);
            try { unlinkSync(rec.filePath); } catch {}

            if (!transcription.text.trim()) { log('No speech detected'); return; }

            log('Structuring...');
            const structured = await structure(transcription.text, config);
            await copyToClipboard(structured.structured);
            log(`Done → clipboard: "${structured.structured.slice(0, 60)}..."`);

            if (config.autoPaste !== false) {
              await new Promise((r) => setTimeout(r, 150));
              await autoPaste();
              log('Auto-pasted');
            }
          } catch (err) {
            recording = false;
            const msg = err instanceof Error ? err.message : String(err);
            log(`Toggle error: ${msg}`);
          }
        })();
      }
      return;
    }

    // ── Memory ──
    if (url.pathname === '/api/memory' && req.method === 'GET') {
      json(res, { memory: getMemory() });
      return;
    }

    if (url.pathname === '/api/memory' && req.method === 'DELETE') {
      clearMemory();
      json(res, { cleared: true });
      return;
    }

    // ── Health ──
    if (url.pathname === '/api/health') {
      json(res, { ok: true, recording, memorySize: getMemory().length });
      return;
    }

    // 404
    json(res, { error: 'Not found' }, 404);
  });

  server.listen(port, '0.0.0.0', () => {
    const ip = getLocalIP();
    log(`\n  Voice daemon running on port ${port}`);
    log(`  ── Desktop ──  http://localhost:${port}`);
    log(`  ── iPhone  ──  http://${ip}:${port}`);
    log(`  ── Hotkey  ──  Option+Space (in browser) or curl -X POST localhost:${port}/api/toggle`);
    log(`  ── Memory  ──  Rolling 10 entries (${getMemory().length} active)\n`);
  });
}

// ── Minimal multipart parser (no deps) ──────────────────────
function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  return match ? (match[1] || match[2]) : null;
}

interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const sep = Buffer.from(`--${boundary}`);
  let pos = 0;

  while (pos < body.length) {
    const start = indexOf(body, sep, pos);
    if (start === -1) break;
    const afterSep = start + sep.length;
    // Check for closing boundary
    if (body[afterSep] === 0x2d && body[afterSep + 1] === 0x2d) break;
    // Skip CRLF after boundary
    const headerStart = afterSep + 2;
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf-8');
    const dataStart = headerEnd + 4;
    const nextBoundary = indexOf(body, sep, dataStart);
    const dataEnd = nextBoundary !== -1 ? nextBoundary - 2 : body.length;

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        data: body.subarray(dataStart, dataEnd),
      });
    }
    pos = nextBoundary !== -1 ? nextBoundary : body.length;
  }
  return parts;
}

function indexOf(buf: Buffer, search: Buffer, offset: number): number {
  for (let i = offset; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
