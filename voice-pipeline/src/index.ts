export { runVoicePipeline, runFromText } from './pipeline.js';
export { record, recordForDuration, checkRecordingDeps } from './recorder.js';
export { transcribe } from './transcriber.js';
export { structure } from './structurer.js';
export { copyToClipboard, autoPaste } from './clipboard.js';
export type {
  VoiceConfig,
  StructureMode,
  RecordingResult,
  TranscriptionResult,
  StructuredResult,
  PipelineResult,
} from './types.js';
