import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import type { SpeechProvider } from '../models.js';
import type { TranscriptionResult, VoiceConfig } from '../types.js';

let client: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  if (!client) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY required');
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export const whisperApiProvider: SpeechProvider = {
  name: 'whisper-api',
  type: 'cloud',

  async available(): Promise<boolean> {
    return !!(process.env.OPENAI_API_KEY);
  },

  async transcribe(audioPath: string, config: VoiceConfig): Promise<TranscriptionResult> {
    const openai = getClient(config.openaiApiKey);
    const start = Date.now();

    const response = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: config.whisperModel || 'whisper-1',
      language: config.language,
      response_format: 'verbose_json',
    });

    return {
      text: response.text,
      language: response.language,
      durationMs: Date.now() - start,
    };
  },
};
