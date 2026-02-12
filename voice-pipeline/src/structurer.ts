import Anthropic from '@anthropic-ai/sdk';
import type { StructureMode, StructuredResult, VoiceConfig } from './types.js';
import { getMemoryContext, addToMemory } from './memory.js';

let client: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!client) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is required for structuring. Set it in .env or pass --anthropic-key');
    }
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

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
): Promise<StructuredResult> {
  const mode: StructureMode = config.mode || 'message';
  const anthropic = getClient(config.anthropicApiKey);

  const memoryContext = getMemoryContext();
  const systemPrompt = memoryContext
    ? `${MODE_PROMPTS[mode]}\n\n${memoryContext}`
    : MODE_PROMPTS[mode];

  const response = await anthropic.messages.create({
    model: config.claudeModel || 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: rawText,
      },
    ],
  });

  const structured = response.content
    .filter((block) => block.type === 'text')
    .map((block) => {
      if (block.type === 'text') return block.text;
      return '';
    })
    .join('\n');

  // Store in rolling memory
  addToMemory({ raw: rawText, structured, mode });

  return {
    original: rawText,
    structured,
    mode,
  };
}
