export type StructureMode = 'message' | 'notes' | 'email' | 'code' | 'tasks' | 'raw';

export interface VoiceConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  mode?: StructureMode;
  autoPaste?: boolean;
  whisperModel?: string;
  claudeModel?: string;
  language?: string;
  recordingDevice?: string;
  silenceThreshold?: number;
  silenceDuration?: number;
}

export interface RecordingResult {
  filePath: string;
  durationMs: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs: number;
}

export interface StructuredResult {
  original: string;
  structured: string;
  mode: StructureMode;
}

export interface PipelineResult {
  transcription: TranscriptionResult;
  structured: StructuredResult;
  copiedToClipboard: boolean;
  autoPasted: boolean;
}
