#!/usr/bin/env node
/**
 * Demand Agent CLI.
 *
 * Usage:
 *   demand-agent run ./brief.json
 *   demand-agent run ./brief.json --max-iterations 12 --threshold 80
 *   demand-agent status
 *
 * brief.json should match the Brief type from ./types.ts.
 */

import { program } from 'commander';
import { config as loadEnv } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { runAgent, getState } from './agent.js';
import { Brief } from './types.js';

loadEnv();

program
  .name('demand-agent')
  .description('Autonomous demand-finding agent powered by Claude Opus 4.5')
  .version('1.0.0');

program
  .command('run <briefPath>')
  .description('Run the demand agent against a brief JSON file')
  .option('-i, --max-iterations <n>', 'Max loop iterations', (v) => parseInt(v, 10))
  .option('-t, --threshold <n>', 'Validation threshold 0-100', (v) => parseInt(v, 10))
  .option('-s, --min-signals <n>', 'Min confirming signals', (v) => parseInt(v, 10))
  .option('-p, --per-round <n>', 'Hypotheses per round', (v) => parseInt(v, 10))
  .option('-k, --api-key <key>', 'Anthropic API key (or ANTHROPIC_API_KEY env)')
  .option('-o, --output <file>', 'Write the final run JSON to this path')
  .action(async (briefPath: string, options) => {
    const resolved = path.resolve(briefPath);
    if (!fs.existsSync(resolved)) {
      console.error(`Brief file not found: ${resolved}`);
      process.exit(1);
    }

    let brief: Brief;
    try {
      brief = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as Brief;
    } catch (err) {
      console.error(`Failed to parse brief JSON: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
      return;
    }

    console.log('');
    console.log('Autonomous Demand Agent - Powered by Claude Opus 4.5');
    console.log('=====================================================');
    console.log(`Goal:   ${brief.goal}`);
    console.log(`Budget: $${brief.budget}`);
    if (brief.skills?.length) console.log(`Skills: ${brief.skills.join(', ')}`);
    if (brief.constraints?.length) console.log(`Constraints: ${brief.constraints.join(', ')}`);
    console.log('');

    try {
      const result = await runAgent({
        brief,
        maxIterations: options.maxIterations,
        validationThreshold: options.threshold,
        minConfirmingSignals: options.minSignals,
        hypothesesPerRound: options.perRound,
        anthropicApiKey: options.apiKey,
        onLog: (msg) => console.log(msg),
        onStageChange: (stage) => console.log(`\n>>> Stage: ${stage.toUpperCase()}\n`),
      });

      console.log('');
      console.log('='.repeat(60));
      console.log('AGENT RESULT');
      console.log('='.repeat(60));
      console.log(`Status: ${result.success ? 'VALIDATED' : 'UNVALIDATED'}`);
      console.log(`Iterations: ${result.iterations.length}`);
      console.log(`Tokens: ${result.totalTokens.toLocaleString()}`);
      console.log(`Duration: ${((result.duration || 0) / 1000).toFixed(1)}s`);
      if (result.summary) console.log(`Summary: ${result.summary}`);
      if (result.error) console.log(`Error: ${result.error}`);

      if (result.winner && result.plan) {
        console.log('');
        console.log('WINNING HYPOTHESIS:');
        console.log(`  ${result.winner.title}`);
        console.log(`  audience: ${result.winner.audience}`);
        console.log(`  offer:    ${result.winner.offer}`);
        console.log(`  channel:  ${result.winner.channel}`);
        console.log(`  price:    $${result.winner.price}`);
        console.log('');
        console.log('GO-TO-MARKET PLAN:');
        console.log(`  headline: ${result.plan.headline}`);
        console.log(`  pitch:    ${result.plan.pitch}`);
        console.log(`  first five moves:`);
        for (const move of result.plan.firstFiveMoves) console.log(`    - ${move}`);
        console.log(`  success metric: ${result.plan.successMetric}`);
      }

      if (options.output) {
        const outPath = path.resolve(options.output);
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
        console.log(`\nRun written to ${outPath}`);
      }

      process.exit(result.success ? 0 : 1);
    } catch (err) {
      console.error('Agent failed:', err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show agent state')
  .action(() => {
    const s = getState();
    console.log('');
    console.log('Demand Agent Status');
    console.log(`  Running:      ${s.isRunning}`);
    console.log(`  Total runs:   ${s.stats.totalRuns}`);
    console.log(`  Validated:    ${s.stats.validatedRuns}`);
    console.log(`  Unvalidated:  ${s.stats.unvalidatedRuns}`);
    console.log(`  Iterations:   ${s.stats.totalIterations}`);
    console.log(`  Tokens used:  ${s.stats.totalTokens.toLocaleString()}`);
    console.log('');
  });

program.parse();
