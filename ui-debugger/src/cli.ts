#!/usr/bin/env node
/**
 * Debug Pipeline CLI
 *
 * Usage:
 *   debug-pipeline run ./my-project
 *   debug-pipeline run ./my-project --no-tests
 *   debug-pipeline watch ./my-project
 */

import { program } from 'commander';
import { config } from 'dotenv';
import { watch } from 'fs';
import * as path from 'path';
import { runPipeline, quickRun, getState, pipelineEvents } from './pipeline.js';

// Load .env
config();

program
  .name('debug-pipeline')
  .description('Autonomous debugging pipeline powered by Claude Opus 4.5')
  .version('1.0.0');

program
  .command('run <projectRoot>')
  .description('Run the debugging pipeline on a project')
  .option('-l, --lint <command>', 'Lint command', 'npm run lint')
  .option('-b, --build <command>', 'Build command', 'npm run build')
  .option('-t, --test <command>', 'Test command', 'npm test')
  .option('--run-lint', 'Enable linting phase')
  .option('--no-tests', 'Skip running tests')
  .option('--no-auto-fix', 'Disable automatic fixing')
  .option('--no-claude-code', 'Disable Claude Code execution (just print fix prompts)')
  .option('--no-git', 'Disable git integration')
  .option('-m, --max-attempts <n>', 'Maximum fix attempts', '3')
  .option('-k, --api-key <key>', 'Anthropic API key (or use ANTHROPIC_API_KEY env var)')
  .action(async (projectRoot: string, options) => {
    console.log('\n🔧 Debug Pipeline - Powered by Claude Opus 4.5\n');
    console.log(`Project: ${projectRoot}`);
    if (options.runLint) console.log(`Lint: ${options.lint}`);
    console.log(`Build: ${options.build}`);
    console.log(`Tests: ${options.tests ? options.test : 'disabled'}`);
    console.log(`Auto-fix: ${options.autoFix ? 'enabled' : 'disabled'}`);
    console.log(`Claude Code: ${options.claudeCode ? 'enabled' : 'disabled'}`);
    console.log('');

    try {
      const result = await runPipeline({
        projectRoot: path.resolve(projectRoot),
        lintCommand: options.lint,
        buildCommand: options.build,
        testCommand: options.test,
        runLint: options.runLint || false,
        runTests: options.tests,
        autoFix: options.autoFix,
        useClaudeCode: options.claudeCode,
        gitEnabled: options.git,
        maxFixAttempts: parseInt(options.maxAttempts),
        anthropicApiKey: options.apiKey,
        onLog: (msg) => console.log(msg),
        onStageChange: (stage) => console.log(`\n>>> Stage: ${stage.toUpperCase()}\n`),
      });

      console.log('\n' + '='.repeat(60));
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
  .command('watch <projectRoot>')
  .description('Watch for file changes and auto-run pipeline')
  .option('-b, --build <command>', 'Build command', 'npm run build')
  .option('-t, --test <command>', 'Test command', 'npm test')
  .option('--no-tests', 'Skip running tests')
  .option('--no-auto-fix', 'Disable automatic fixing')
  .option('-d, --debounce <ms>', 'Debounce delay in ms', '1000')
  .option('-k, --api-key <key>', 'Anthropic API key')
  .action(async (projectRoot: string, options) => {
    console.log('\n👁️  Debug Pipeline - Watch Mode\n');
    console.log(`Project: ${path.resolve(projectRoot)}`);
    console.log(`Build: ${options.build}`);
    console.log(`Tests: ${options.tests ? options.test : 'disabled'}`);
    console.log(`Debounce: ${options.debounce}ms`);
    console.log('\nWatching for changes... (Ctrl+C to stop)\n');

    const resolvedRoot = path.resolve(projectRoot);
    const srcDir = path.join(resolvedRoot, 'src');
    let debounceTimer: NodeJS.Timeout | null = null;
    let isRunning = false;

    const triggerPipeline = async () => {
      if (isRunning) {
        console.log('⏳ Pipeline already running, skipping...');
        return;
      }

      isRunning = true;
      console.log('\n' + '─'.repeat(60));
      console.log(`🔄 Change detected - running pipeline at ${new Date().toLocaleTimeString()}`);
      console.log('─'.repeat(60) + '\n');

      try {
        const result = await runPipeline({
          projectRoot: resolvedRoot,
          buildCommand: options.build,
          testCommand: options.test,
          runTests: options.tests,
          autoFix: options.autoFix,
          useClaudeCode: true,
          gitEnabled: true,
          gitCommitFixes: true,
          anthropicApiKey: options.apiKey,
          onLog: (msg) => console.log(msg),
          onStageChange: (stage) => console.log(`>>> ${stage.toUpperCase()}`),
        });

        console.log('\n' + '─'.repeat(60));
        if (result.success) {
          console.log(`✅ SUCCESS in ${((result.duration || 0) / 1000).toFixed(1)}s`);
        } else {
          console.log(`❌ FAILED: ${result.error}`);
        }
        if (result.fixAttempts.length > 0) {
          console.log(`🔧 ${result.fixAttempts.length} fix attempt(s)`);
        }
        console.log('─'.repeat(60));
        console.log('\n👁️  Watching for more changes...\n');
      } catch (error) {
        console.error('Pipeline error:', error);
      } finally {
        isRunning = false;
      }
    };

    const onChange = (eventType: string, filename: string | null) => {
      if (!filename) return;

      // Ignore non-source files
      if (
        filename.endsWith('.js') ||
        filename.endsWith('.map') ||
        filename.includes('node_modules') ||
        filename.includes('.git') ||
        filename.startsWith('.') ||
        filename.includes('dist/')
      ) {
        return;
      }

      // Debounce
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        console.log(`📝 ${filename} ${eventType}`);
        triggerPipeline();
      }, parseInt(options.debounce));
    };

    // Watch src directory
    try {
      watch(srcDir, { recursive: true }, onChange);
      console.log(`Watching: ${srcDir}`);
    } catch {
      // Fallback to watching project root if no src dir
      watch(resolvedRoot, { recursive: true }, onChange);
      console.log(`Watching: ${resolvedRoot}`);
    }

    // Run initial pipeline
    await triggerPipeline();

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n\n👋 Stopping watch mode...\n');
      process.exit(0);
    });
  });

program
  .command('quick <projectRoot>')
  .description('Auto-detect project settings and run pipeline')
  .option('-k, --api-key <key>', 'Anthropic API key')
  .action(async (projectRoot: string, options) => {
    console.log('\n🔧 Debug Pipeline - Quick Run\n');
    console.log(`Project: ${projectRoot}`);
    console.log('Auto-detecting settings...\n');

    try {
      const result = await quickRun(path.resolve(projectRoot), options.apiKey);

      console.log('\n' + '='.repeat(60));
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
  .command('verify <projectRoot>')
  .description('Verify implementation against plan before continuing')
  .option('-s, --since <commit>', 'Check changes since commit', 'HEAD~5')
  .option('-r, --roundtable <url>', 'Vibecoder roundtable API URL', 'http://localhost:3001')
  .option('--session <id>', 'Session ID for roundtable')
  .option('-k, --api-key <key>', 'Anthropic API key')
  .option('--ui', 'Run UI tests (requires Playwright)')
  .option('--base-url <url>', 'Base URL for UI tests')
  .action(async (projectRoot: string, options) => {
    console.log('\n🔍 Verification Agent\n');
    console.log(`Project: ${path.resolve(projectRoot)}`);
    console.log(`Checking changes since: ${options.since}`);
    console.log('');

    // Dynamic import to avoid circular deps
    const { verify } = await import('./verificationAgent.js');

    try {
      const result = await verify({
        projectRoot: path.resolve(projectRoot),
        sinceCommit: options.since,
        roundtableUrl: options.roundtable,
        sessionId: options.session,
        apiKey: options.apiKey,
        runUITests: options.ui,
        baseUrl: options.baseUrl,
      });

      console.log('\n' + '='.repeat(60));
      console.log('VERIFICATION REPORT');
      console.log('='.repeat(60));

      // Status
      const statusEmoji = {
        pass: '✅',
        fail: '❌',
        partial: '⚠️',
        blocked: '🚫',
      }[result.status];
      console.log(`\nStatus: ${statusEmoji} ${result.status.toUpperCase()}`);

      // Implementation summary
      console.log(`\n📁 Implementation:`);
      console.log(`   Files created: ${result.implementation.filesCreated.length}`);
      console.log(`   Files modified: ${result.implementation.filesModified.length}`);
      if (result.implementation.filesCreated.length > 0) {
        console.log(`   New: ${result.implementation.filesCreated.slice(0, 5).join(', ')}`);
      }

      // Test plan
      console.log(`\n🧪 Test Plan:`);
      console.log(`   Scenarios: ${result.testPlan.scenarios.length}`);
      for (const scenario of result.testPlan.scenarios) {
        console.log(`   - [${scenario.priority}] ${scenario.name} (${scenario.type})`);
      }

      // Coverage
      if (result.testPlan.coverage.mustHavesMissing.length > 0) {
        console.log(`\n⚠️  Missing Coverage:`);
        for (const missing of result.testPlan.coverage.mustHavesMissing) {
          console.log(`   - ${missing}`);
        }
      }

      // Flags
      if (result.flags.length > 0) {
        console.log(`\n🚩 Flags:`);
        for (const flag of result.flags) {
          const icon = { critical: '🔴', warning: '🟡', info: '🔵' }[flag.severity];
          console.log(`   ${icon} [${flag.severity}] ${flag.message}`);
          if (flag.suggestion) {
            console.log(`      → ${flag.suggestion}`);
          }
        }
      }

      // Summary
      console.log(`\n📋 Summary: ${result.summary}`);
      console.log(`\n🚦 Ready to continue: ${result.readyToContinue ? 'YES' : 'NO'}`);
      console.log('');

      process.exit(result.readyToContinue ? 0 : 1);
    } catch (error) {
      console.error('Verification failed:', error);
      process.exit(1);
    }
  });

program
  .command('ui-test <baseUrl>')
  .description('Run UI tests against a running app')
  .option('-p, --project <projectRoot>', 'Project root for plan context', '.')
  .option('-s, --since <commit>', 'Check changes since commit', 'HEAD~5')
  .option('-k, --api-key <key>', 'Anthropic API key')
  .option('--headless', 'Run in headless mode (default: true)')
  .option('--no-headless', 'Show browser window')
  .option('-o, --output <dir>', 'Screenshot output directory', './screenshots')
  .action(async (baseUrl: string, options) => {
    console.log('\n🎭 UI Tester - Playwright Integration\n');
    console.log(`Target: ${baseUrl}`);
    console.log(`Headless: ${options.headless}`);
    console.log(`Screenshots: ${options.output}`);
    console.log('');

    const { smokeTest, runUITests } = await import('./uiTester.js');
    const { generateTestPlan, checkImplementation } = await import('./verificationAgent.js');

    try {
      // First run smoke test
      console.log('Running smoke test...');
      const smoke = await smokeTest(baseUrl, {
        headless: options.headless,
        screenshotDir: options.output,
      });

      if (!smoke.passed) {
        console.log('\n❌ SMOKE TEST FAILED');
        console.log(`Error: ${smoke.error}`);
        if (smoke.consoleErrors.length > 0) {
          console.log('Console errors:');
          smoke.consoleErrors.forEach(e => console.log(`  - ${e}`));
        }
        if (smoke.screenshot) {
          console.log(`Screenshot: ${smoke.screenshot}`);
        }
        process.exit(1);
      }

      console.log('✅ Smoke test passed\n');

      // Generate test plan from code changes
      const projectRoot = path.resolve(options.project);
      const implementation = checkImplementation(projectRoot, options.since);

      if (implementation.filesCreated.length === 0 && implementation.filesModified.length === 0) {
        console.log('No code changes detected, skipping detailed tests.');
        process.exit(0);
      }

      console.log('Generating test plan from code changes...');
      const testPlan = await generateTestPlan(
        {
          brief: 'UI verification based on recent changes',
          mustHave: [],
          mustNot: [],
          doneLooksLike: 'All UI elements work correctly',
        },
        implementation,
        options.apiKey
      );

      console.log(`\nTest plan: ${testPlan.scenarios.length} scenarios`);
      testPlan.scenarios.forEach(s => console.log(`  - ${s.name} (${s.type})`));
      console.log('');

      // Run UI tests
      console.log('Running UI tests...');
      const results = await runUITests(testPlan, {
        baseUrl,
        headless: options.headless,
        screenshotDir: options.output,
        apiKey: options.apiKey,
      });

      // Report results
      console.log('\n' + '='.repeat(60));
      console.log('UI TEST RESULTS');
      console.log('='.repeat(60));

      for (const result of results.results) {
        const icon = result.passed ? '✅' : '❌';
        console.log(`\n${icon} ${result.scenarioName}`);
        console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        if (result.screenshot) {
          console.log(`   Screenshot: ${result.screenshot}`);
        }
        if (result.consoleErrors.length > 0) {
          console.log(`   Console errors: ${result.consoleErrors.length}`);
        }
      }

      console.log('\n' + '─'.repeat(60));
      console.log(`Total: ${results.total} | Passed: ${results.successful} | Failed: ${results.failed}`);
      console.log(`Duration: ${(results.duration / 1000).toFixed(1)}s`);
      console.log('');

      process.exit(results.passed ? 0 : 1);
    } catch (error) {
      console.error('UI testing failed:', error);
      process.exit(1);
    }
  });

program
  .command('smoke <baseUrl>')
  .description('Quick smoke test - just check if app loads')
  .option('-o, --output <dir>', 'Screenshot output directory', './screenshots')
  .option('--no-headless', 'Show browser window')
  .action(async (baseUrl: string, options) => {
    console.log('\n💨 Quick Smoke Test\n');
    console.log(`Target: ${baseUrl}`);
    console.log('');

    const { smokeTest } = await import('./uiTester.js');

    try {
      const result = await smokeTest(baseUrl, {
        headless: options.headless,
        screenshotDir: options.output,
      });

      if (result.passed) {
        console.log('✅ App loads successfully');
      } else {
        console.log('❌ App failed to load');
        console.log(`Error: ${result.error}`);
      }

      if (result.consoleErrors.length > 0) {
        console.log(`\n⚠️  Console errors (${result.consoleErrors.length}):`);
        result.consoleErrors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
      }

      if (result.screenshot) {
        console.log(`\nScreenshot: ${result.screenshot}`);
      }

      process.exit(result.passed ? 0 : 1);
    } catch (error) {
      console.error('Smoke test failed:', error);
      process.exit(1);
    }
  });

program
  .command('test-data')
  .description('Generate test data files (CSV, JSON, users, products, images)')
  .option('-t, --type <type>', 'Data type: csv, json, users, products, image, custom', 'csv')
  .option('-c, --count <n>', 'Number of records', '10')
  .option('-o, --output <dir>', 'Output directory', './test-data')
  .option('-f, --filename <name>', 'Output filename (without extension)')
  .option('-s, --schema <json>', 'Schema for CSV/JSON (JSON string)')
  .option('-d, --description <text>', 'Description for custom data generation')
  .option('-k, --api-key <key>', 'Anthropic API key (for custom type)')
  .action(async (options) => {
    console.log('\n📦 Test Data Generator\n');

    const { generateTestData, generateUsers, generateProducts } = await import('./testDataAgent.js');

    const outputDir = path.resolve(options.output);
    const count = parseInt(options.count);

    try {
      let result;

      switch (options.type) {
        case 'users':
          console.log(`Generating ${count} test users...`);
          result = await generateTestData(
            { type: 'users', description: 'Test users', count, outputPath: options.filename },
            outputDir
          );
          break;

        case 'products':
          console.log(`Generating ${count} test products...`);
          result = await generateTestData(
            { type: 'products', description: 'Test products', count, outputPath: options.filename },
            outputDir
          );
          break;

        case 'image':
          console.log('Generating placeholder image...');
          result = await generateTestData(
            { type: 'image', description: 'Placeholder image', outputPath: options.filename },
            outputDir
          );
          break;

        case 'custom':
          if (!options.description) {
            console.error('Custom type requires --description');
            process.exit(1);
          }
          console.log(`Generating custom data: ${options.description}`);
          result = await generateTestData(
            { type: 'custom', description: options.description, count, outputPath: options.filename },
            outputDir,
            options.apiKey
          );
          break;

        case 'json':
        case 'csv':
        default:
          let schema = { id: 'id', name: 'name', email: 'email', value: 'number' };
          if (options.schema) {
            try {
              schema = JSON.parse(options.schema);
            } catch {
              console.error('Invalid schema JSON');
              process.exit(1);
            }
          }
          console.log(`Generating ${count} ${options.type.toUpperCase()} records...`);
          console.log(`Schema: ${JSON.stringify(schema)}`);
          result = await generateTestData(
            { type: options.type as 'csv' | 'json', description: `${options.type} data`, schema, count, outputPath: options.filename },
            outputDir
          );
          break;
      }

      console.log('\n✅ Generated successfully!');
      console.log(`   Type: ${result.type}`);
      console.log(`   Path: ${result.path}`);
      if (result.rowCount) console.log(`   Rows: ${result.rowCount}`);
      console.log('\nPreview:');
      console.log('─'.repeat(40));
      console.log(result.preview);
      console.log('─'.repeat(40));
      console.log('');
    } catch (error) {
      console.error('Generation failed:', error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show pipeline status')
  .action(() => {
    const state = getState();
    console.log('\nPipeline Status:');
    console.log(`  Running: ${state.isRunning}`);
    console.log(`  Total runs: ${state.stats.totalRuns}`);
    console.log(`  Successful: ${state.stats.successfulRuns}`);
    console.log(`  Failed: ${state.stats.failedRuns}`);
    console.log(`  Fix attempts: ${state.stats.totalFixAttempts}`);
    console.log(`  Successful fixes: ${state.stats.successfulFixes}`);
    console.log('');
  });

program.parse();
