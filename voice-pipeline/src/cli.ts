#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { StructureMode, VoiceConfig } from './types.js';
import { runVoicePipeline, runFromText } from './pipeline.js';
import { checkRecordingDeps } from './recorder.js';

// Load .env from voice-pipeline directory
loadEnv({ path: resolve(import.meta.dirname || '.', '..', '.env') });

const program = new Command();

program
  .name('voice')
  .description('Voice-to-structured-output pipeline. Talk freely, get organized text.')
  .version('1.0.0');

// ── voice listen ──────────────────────────────────────────────
program
  .command('listen')
  .alias('l')
  .description('Record from mic → transcribe → structure → clipboard → paste')
  .option('-m, --mode <mode>', 'Output mode: message, notes, email, code, tasks, raw', 'message')
  .option('--no-paste', 'Disable auto-paste (still copies to clipboard)')
  .option('--openai-key <key>', 'OpenAI API key')
  .option('--anthropic-key <key>', 'Anthropic API key')
  .option('--language <lang>', 'Audio language hint (e.g. en, es, fr)')
  .option('--claude-model <model>', 'Claude model for structuring', 'claude-haiku-4-5-20251001')
  .action(async (opts) => {
    // Check recording deps first
    const deps = checkRecordingDeps();
    if (!deps.available) {
      console.error(`\n  No audio recording tool found.`);
      console.error(`  Install one: ${deps.installHint}\n`);
      process.exit(1);
    }

    const config: VoiceConfig = {
      mode: opts.mode as StructureMode,
      autoPaste: opts.paste,
      openaiApiKey: opts.openaiKey,
      anthropicApiKey: opts.anthropicKey,
      language: opts.language,
      claudeModel: opts.claudeModel,
    };

    console.log(`\n  Mode: ${config.mode}`);
    console.log(`  Recording tool: ${deps.tool}`);
    console.log(`  Press Enter to stop recording...\n`);

    const controller = new AbortController();

    // Listen for Enter key to stop recording
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', () => {
      controller.abort();
      rl.close();
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      controller.abort();
      rl.close();
      process.exit(0);
    });

    try {
      const result = await runVoicePipeline(config, {
        onRecordingStart: () => console.log('  🎙  Recording... (press Enter to stop)'),
        onRecordingStop: () => console.log('  ⏹  Recording stopped'),
        onTranscribing: () => process.stdout.write('  ✦  Transcribing...'),
        onTranscribed: (text) => {
          console.log(` done (${text.length} chars)`);
          console.log(`\n  ── Raw ──`);
          console.log(`  ${text}\n`);
        },
        onStructuring: () => process.stdout.write('  ✦  Structuring...'),
        onStructured: (text) => {
          console.log(' done');
          console.log(`\n  ── Structured ──`);
          console.log(`  ${text.split('\n').join('\n  ')}\n`);
        },
        onCopied: () => console.log('  ✓  Copied to clipboard'),
        onPasted: () => console.log('  ✓  Auto-pasted'),
      }, controller.signal);

      if (!result.copiedToClipboard) {
        console.log('  ⚠  Could not copy to clipboard (install xclip or xsel)');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No speech detected')) {
        console.log('\n  No speech detected. Try again.\n');
      } else {
        console.error(`\n  Error: ${msg}\n`);
      }
      process.exit(1);
    }
  });

// ── voice type ────────────────────────────────────────────────
program
  .command('type')
  .alias('t')
  .description('Type or paste text → structure → clipboard → paste')
  .option('-m, --mode <mode>', 'Output mode: message, notes, email, code, tasks, raw', 'message')
  .option('--no-paste', 'Disable auto-paste')
  .option('--anthropic-key <key>', 'Anthropic API key')
  .option('--claude-model <model>', 'Claude model for structuring', 'claude-haiku-4-5-20251001')
  .action(async (opts) => {
    const config: VoiceConfig = {
      mode: opts.mode as StructureMode,
      autoPaste: opts.paste,
      anthropicApiKey: opts.anthropicKey,
      claudeModel: opts.claudeModel,
    };

    console.log(`\n  Mode: ${config.mode}`);
    console.log(`  Paste or type your text, then press Enter twice to process:\n`);

    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let emptyCount = 0;

    const text = await new Promise<string>((resolve) => {
      rl.on('line', (line) => {
        if (line.trim() === '') {
          emptyCount++;
          if (emptyCount >= 2) {
            rl.close();
            resolve(lines.join('\n'));
            return;
          }
        } else {
          emptyCount = 0;
        }
        lines.push(line);
      });
    });

    if (!text.trim()) {
      console.log('  No text provided.\n');
      process.exit(1);
    }

    try {
      const result = await runFromText(text, config, {
        onStructuring: () => process.stdout.write('  ✦  Structuring...'),
        onStructured: (structured) => {
          console.log(' done');
          console.log(`\n  ── Structured ──`);
          console.log(`  ${structured.split('\n').join('\n  ')}\n`);
        },
        onCopied: () => console.log('  ✓  Copied to clipboard'),
        onPasted: () => console.log('  ✓  Auto-pasted'),
      });

      if (!result.copiedToClipboard) {
        console.log('  ⚠  Could not copy to clipboard');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  Error: ${msg}\n`);
      process.exit(1);
    }
  });

// ── voice pipe ────────────────────────────────────────────────
program
  .command('pipe')
  .alias('p')
  .description('Read stdin → structure → clipboard → paste (for piping from other tools)')
  .option('-m, --mode <mode>', 'Output mode: message, notes, email, code, tasks, raw', 'message')
  .option('--no-paste', 'Disable auto-paste')
  .option('--anthropic-key <key>', 'Anthropic API key')
  .option('--claude-model <model>', 'Claude model for structuring', 'claude-haiku-4-5-20251001')
  .option('-q, --quiet', 'Only output the structured text (for further piping)')
  .action(async (opts) => {
    const config: VoiceConfig = {
      mode: opts.mode as StructureMode,
      autoPaste: opts.paste,
      anthropicApiKey: opts.anthropicKey,
      claudeModel: opts.claudeModel,
    };

    // Read all of stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8').trim();

    if (!text) {
      if (!opts.quiet) console.error('No input received on stdin');
      process.exit(1);
    }

    try {
      const result = await runFromText(text, config, {
        onStructured: (structured) => {
          if (opts.quiet) {
            process.stdout.write(structured);
          } else {
            console.log(structured);
          }
        },
        onCopied: () => { if (!opts.quiet) console.error('  ✓  Copied to clipboard'); },
        onPasted: () => { if (!opts.quiet) console.error('  ✓  Auto-pasted'); },
      });

      if (!result.copiedToClipboard && !opts.quiet) {
        console.error('  ⚠  Could not copy to clipboard');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

// ── voice loop ────────────────────────────────────────────────
program
  .command('loop')
  .description('Continuous listen mode — records, processes, repeats. Press Ctrl+C to exit.')
  .option('-m, --mode <mode>', 'Output mode: message, notes, email, code, tasks, raw', 'message')
  .option('--no-paste', 'Disable auto-paste')
  .option('--openai-key <key>', 'OpenAI API key')
  .option('--anthropic-key <key>', 'Anthropic API key')
  .option('--language <lang>', 'Audio language hint')
  .option('--claude-model <model>', 'Claude model for structuring', 'claude-haiku-4-5-20251001')
  .action(async (opts) => {
    const deps = checkRecordingDeps();
    if (!deps.available) {
      console.error(`\n  No audio recording tool found.`);
      console.error(`  Install one: ${deps.installHint}\n`);
      process.exit(1);
    }

    const config: VoiceConfig = {
      mode: opts.mode as StructureMode,
      autoPaste: opts.paste,
      openaiApiKey: opts.openaiKey,
      anthropicApiKey: opts.anthropicKey,
      language: opts.language,
      claudeModel: opts.claudeModel,
    };

    console.log(`\n  Voice Loop — Mode: ${config.mode}`);
    console.log(`  Press Enter after each recording. Ctrl+C to exit.\n`);

    let running = true;
    process.on('SIGINT', () => {
      running = false;
      console.log('\n  Bye!\n');
      process.exit(0);
    });

    let count = 0;
    while (running) {
      count++;
      const controller = new AbortController();

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', () => {
        controller.abort();
        rl.close();
      });

      try {
        console.log(`  ── #${count} ──`);
        await runVoicePipeline(config, {
          onRecordingStart: () => console.log('  🎙  Recording... (Enter to stop)'),
          onRecordingStop: () => console.log('  ⏹  Stopped'),
          onTranscribing: () => process.stdout.write('  ✦  Transcribing...'),
          onTranscribed: (text) => console.log(` "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`),
          onStructuring: () => process.stdout.write('  ✦  Structuring...'),
          onStructured: () => console.log(' done'),
          onCopied: () => console.log('  ✓  Clipboard + paste ready'),
          onPasted: () => console.log('  ✓  Pasted'),
        }, controller.signal);
      } catch {
        console.log('  (skipped)\n');
      }
      console.log('');
    }
  });

program.parse();
