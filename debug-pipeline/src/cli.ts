#!/usr/bin/env node
/**
 * Debug Pipeline CLI
 *
 * Usage:
 *   debug-pipeline run ./my-project
 *   debug-pipeline run ./my-project --no-tests
 *   debug-pipeline run ./my-project --no-auto-fix
 */

import { program } from 'commander';
import { config } from 'dotenv';
import { runPipeline, quickRun, getState } from './pipeline.js';

// Load .env
config();

program
  .name('debug-pipeline')
  .description('Autonomous debugging pipeline powered by Claude Opus 4.5')
  .version('1.0.0');

program
  .command('run <projectRoot>')
  .description('Run the debugging pipeline on a project')
  .option('-b, --build <command>', 'Build command', 'npm run build')
  .option('-t, --test <command>', 'Test command', 'npm test')
  .option('--no-tests', 'Skip running tests')
  .option('--no-auto-fix', 'Disable automatic fixing')
  .option('--no-claude-code', 'Disable Claude Code execution (just print fix prompts)')
  .option('-m, --max-attempts <n>', 'Maximum fix attempts', '3')
  .option('-k, --api-key <key>', 'Anthropic API key (or use ANTHROPIC_API_KEY env var)')
  .action(async (projectRoot: string, options) => {
    console.log('\\n🔧 Debug Pipeline - Powered by Claude Opus 4.5\\n');
    console.log(`Project: ${projectRoot}`);
    console.log(`Build: ${options.build}`);
    console.log(`Tests: ${options.tests ? options.test : 'disabled'}`);
    console.log(`Auto-fix: ${options.autoFix ? 'enabled' : 'disabled'}`);
    console.log(`Claude Code: ${options.claudeCode ? 'enabled' : 'disabled'}`);
    console.log('');

    try {
      const result = await runPipeline({
        projectRoot,
        buildCommand: options.build,
        testCommand: options.test,
        runTests: options.tests,
        autoFix: options.autoFix,
        useClaudeCode: options.claudeCode,
        maxFixAttempts: parseInt(options.maxAttempts),
        anthropicApiKey: options.apiKey,
        onLog: (msg) => console.log(msg),
        onStageChange: (stage) => console.log(`\\n>>> Stage: ${stage.toUpperCase()}\\n`),
      });

      console.log('\\n' + '='.repeat(60));
      console.log('PIPELINE RESULT');
      console.log('='.repeat(60));
      console.log(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      console.log(`Duration: ${((result.duration || 0) / 1000).toFixed(1)}s`);
      console.log(`Fix attempts: ${result.fixAttempts.length}`);
      if (result.summary) console.log(`Summary: ${result.summary}`);
      if (result.error) console.log(`Error: ${result.error}`);
      console.log('');

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('Pipeline failed:', error);
      process.exit(1);
    }
  });

program
  .command('quick <projectRoot>')
  .description('Auto-detect project settings and run pipeline')
  .option('-k, --api-key <key>', 'Anthropic API key')
  .action(async (projectRoot: string, options) => {
    console.log('\\n🔧 Debug Pipeline - Quick Run\\n');
    console.log(`Project: ${projectRoot}`);
    console.log('Auto-detecting settings...\\n');

    try {
      const result = await quickRun(projectRoot, options.apiKey);

      console.log('\\n' + '='.repeat(60));
      console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      console.log(`Duration: ${((result.duration || 0) / 1000).toFixed(1)}s`);
      if (result.summary) console.log(`Summary: ${result.summary}`);
      console.log('');

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('Pipeline failed:', error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show pipeline status')
  .action(() => {
    const state = getState();
    console.log('\\nPipeline Status:');
    console.log(`  Running: ${state.isRunning}`);
    console.log(`  Total runs: ${state.stats.totalRuns}`);
    console.log(`  Successful: ${state.stats.successfulRuns}`);
    console.log(`  Failed: ${state.stats.failedRuns}`);
    console.log(`  Fix attempts: ${state.stats.totalFixAttempts}`);
    console.log(`  Successful fixes: ${state.stats.successfulFixes}`);
    console.log('');
  });

program.parse();
