import type { StructureMode, StructuredResult, VoiceConfig } from './types.js';
import { getMemoryContext, addToMemory } from './memory.js';
import { resolveLLMProvider } from './models.js';
import { loadConfig, getConfigForMode } from './config.js';

const MODE_PROMPTS: Record<StructureMode, string> = {
  message: `You are a voice-to-text structurer. The user dictated a message by speaking freely.
Your job: take their rambling speech and turn it into a clear, well-written message.
- Fix grammar and remove filler words (um, uh, like, you know)
- Organize the thoughts logically
- Keep their voice and intent — don't make it robotic
- Use recent context to resolve references like "that thing", "what I said earlier", etc.
- Output ONLY the cleaned message, nothing else. No preamble, no explanation.`,

  notes: `You are a voice-to-text structurer. The user dictated notes by speaking freely.
Your job: organize their rambling into clean, structured notes.
- Use bullet points or numbered lists where appropriate
- Group related ideas together
- Remove filler words and false starts
- Add brief headers if there are distinct topics
- Use recent context to connect related ideas across dictations
- Output ONLY the structured notes, nothing else.`,

  email: `You are a voice-to-text structurer. The user dictated an email by speaking freely.
Your job: turn their rambling into a professional, clear email.
- Include subject line if they mentioned one
- Proper greeting and sign-off
- Clear paragraphs
- Professional but not stiff — match their tone
- Use recent context if they reference earlier topics
- Output ONLY the email, nothing else.`,

  code: `You are a voice-to-text structurer. The user is dictating instructions for code or describing code changes.
Your job: structure their speech into a clear, actionable technical specification or prompt.
- Extract the specific technical requirements
- List files to change if mentioned
- Organize into steps if applicable
- Preserve all technical details (function names, types, etc.)
- Use recent context to understand what project/files they're referring to
- Output ONLY the structured spec/prompt, nothing else.`,

  tasks: `You are a voice-to-text structurer. The user is dictating tasks or a to-do list.
Your job: extract and organize their tasks.
- Each task on its own line with a checkbox: - [ ] Task
- Group by priority or category if they mentioned any
- Remove filler, keep actionable items
- Use recent context to avoid duplicating previously mentioned tasks
- Output ONLY the task list, nothing else.`,

  raw: `You are a voice-to-text structurer. Clean up the transcription minimally.
- Fix obvious speech-to-text errors
- Remove filler words (um, uh, like, you know)
- Fix punctuation and capitalization
- Keep everything else as-is
- Output ONLY the cleaned text, nothing else.`,
};

export async function structure(
  rawText: string,
  config: VoiceConfig = {}
): Promise<StructuredResult & { providerName: string }> {
  const mode: StructureMode = config.mode || 'message';
  const appConfig = loadConfig();
  const modeConfig = getConfigForMode(mode);

  // Build system prompt with memory context
  const memoryContext = getMemoryContext();
  const basePrompt = MODE_PROMPTS[mode];
  const systemPrompt = memoryContext
    ? `${basePrompt}\n\n${memoryContext}`
    : basePrompt;

  // Determine which LLM provider to use
  let preferred = config.llmProvider || modeConfig.llmProvider;
  if (config.offlineMode || appConfig.offlineMode) {
    preferred = 'ollama';
  }

  const provider = await resolveLLMProvider(preferred);
  const structured = await provider.complete(rawText, systemPrompt, config);

  // Store in rolling memory
  addToMemory({ raw: rawText, structured, mode });

  return { original: rawText, structured, mode, providerName: provider.name };
}

export function getModePrompt(mode: StructureMode): string {
  return MODE_PROMPTS[mode];
}
