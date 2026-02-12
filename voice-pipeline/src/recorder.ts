import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecordingResult } from './types.js';

const TEMP_DIR = join(tmpdir(), 'voice-pipeline');

function ensureTempDir(): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function detectRecordingTool(): 'sox' | 'arecord' | 'ffmpeg' | null {
  const tools = ['sox', 'arecord', 'ffmpeg'];
  for (const tool of tools) {
    try {
      execSync(`which ${tool}`, { stdio: 'ignore' });
      return tool as 'sox' | 'arecord' | 'ffmpeg';
    } catch {
      continue;
    }
  }
  return null;
}

export function checkRecordingDeps(): { available: boolean; tool: string | null; installHint: string } {
  const tool = detectRecordingTool();
  if (tool) {
    return { available: true, tool, installHint: '' };
  }
  const platform = process.platform;
  let installHint: string;
  if (platform === 'darwin') {
    installHint = 'brew install sox';
  } else if (platform === 'linux') {
    installHint = 'sudo apt install sox alsa-utils';
  } else {
    installHint = 'Install sox: https://sox.sourceforge.net/';
  }
  return { available: false, tool: null, installHint };
}

export async function record(signal: AbortSignal): Promise<RecordingResult> {
  ensureTempDir();
  const filePath = join(TEMP_DIR, `recording-${Date.now()}.wav`);
  const tool = detectRecordingTool();

  if (!tool) {
    throw new Error('No recording tool found. Install sox: brew install sox (mac) / sudo apt install sox (linux)');
  }

  const startTime = Date.now();

  return new Promise<RecordingResult>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;

    if (tool === 'sox') {
      // sox rec: records from default mic, 16kHz mono WAV (optimal for Whisper)
      proc = spawn('rec', [
        '-r', '16000',    // 16kHz sample rate
        '-c', '1',        // mono
        '-b', '16',       // 16-bit
        filePath,
        'silence', '1', '0.1', '1%',  // start on sound
        '1', '2.0', '1%',             // stop after 2s silence
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    } else if (tool === 'arecord') {
      proc = spawn('arecord', [
        '-f', 'S16_LE',
        '-r', '16000',
        '-c', '1',
        filePath,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    } else {
      // ffmpeg
      const inputDevice = process.platform === 'darwin' ? 'avfoundation' : 'pulse';
      const inputSource = process.platform === 'darwin' ? ':0' : 'default';
      proc = spawn('ffmpeg', [
        '-f', inputDevice,
        '-i', inputSource,
        '-ar', '16000',
        '-ac', '1',
        '-y',
        filePath,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    }

    const onAbort = () => {
      proc.kill('SIGTERM');
    };

    signal.addEventListener('abort', onAbort, { once: true });

    proc.on('close', () => {
      signal.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startTime;
      if (existsSync(filePath)) {
        resolve({ filePath, durationMs });
      } else {
        reject(new Error('Recording failed — no audio file produced'));
      }
    });

    proc.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(`Recording process error: ${err.message}`));
    });
  });
}

export async function recordForDuration(durationSec: number): Promise<RecordingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), durationSec * 1000);
  try {
    return await record(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
