import Anthropic from '@anthropic-ai/sdk';
import type { StructureMode, StructuredResult, VoiceConfig } from './types.js';

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
- Output ONLY the cleaned message, nothing else. No preamble, no explanation.`,

  notes: `You are a voice-to-text structurer. The user dictated notes by speaking freely.
Your job: organize their rambling into clean, structured notes.
- Use bullet points or numbered lists where appropriate
- Group related ideas together
- Remove filler words and false starts
- Add brief headers if there are distinct topics
- Output ONLY the structured notes, nothing else.`,

  email: `You are a voice-to-text structurer. The user dictated an email by speaking freely.
Your job: turn their rambling into a professional, clear email.
- Include subject line if they mentioned one
- Proper greeting and sign-off
- Clear paragraphs
- Professional but not stiff — match their tone
- Output ONLY the email, nothing else.`,

  code: `You are a voice-to-text structurer. The user is dictating instructions for code or describing code changes.
Your job: structure their speech into a clear, actionable technical specification or prompt.
- Extract the specific technical requirements
- List files to change if mentioned
- Organize into steps if applicable
- Preserve all technical details (function names, types, etc.)
- Output ONLY the structured spec/prompt, nothing else.`,

  tasks: `You are a voice-to-text structurer. The user is dictating tasks or a to-do list.
Your job: extract and organize their tasks.
- Each task on its own line with a checkbox: - [ ] Task
- Group by priority or category if they mentioned any
- Remove filler, keep actionable items
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

  const response = await anthropic.messages.create({
    model: config.claudeModel || 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: MODE_PROMPTS[mode],
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

  return {
    original: rawText,
    structured,
    mode,
  };
}
