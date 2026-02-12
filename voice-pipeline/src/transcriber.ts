import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import type { TranscriptionResult, VoiceConfig } from './types.js';

let client: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  if (!client) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is required for Whisper transcription. Set it in .env or pass --openai-key');
    }
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export async function transcribe(
  audioFilePath: string,
  config: VoiceConfig = {}
): Promise<TranscriptionResult> {
  const openai = getClient(config.openaiApiKey);
  const startTime = Date.now();

  const response = await openai.audio.transcriptions.create({
    file: createReadStream(audioFilePath),
    model: config.whisperModel || 'whisper-1',
    language: config.language,
    response_format: 'verbose_json',
  });

  const durationMs = Date.now() - startTime;

  return {
    text: response.text,
    language: response.language,
    durationMs,
  };
}
