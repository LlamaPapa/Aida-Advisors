/**
 * UI Tester - Playwright Integration
 *
 * Runs actual browser tests based on the test plan from verification agent.
 * Uses Claude to translate natural language test steps into Playwright actions.
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import type { TestPlan, VerificationResult } from './verificationAgent.js';
import { generateTestData, generateCSV, generatePlaceholderImage } from './testDataAgent.js';

export interface UITestConfig {
  baseUrl: string;
  screenshotDir?: string;
  testDataDir?: string;
  timeout?: number;
  headless?: boolean;
  apiKey?: string;
  viewport?: { width: number; height: number };
}

export interface UITestResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  steps: Array<{
    step: string;
    action: string;
    success: boolean;
    error?: string;
    screenshot?: string;
    duration: number;
  }>;
  error?: string;
  screenshot?: string;
  duration: number;
  consoleErrors: string[];
}

export interface UITestSuiteResult {
  passed: boolean;
  total: number;
  successful: number;
  failed: number;
  results: UITestResult[];
  duration: number;
}

// Playwright action types that Claude can generate
interface PlaywrightAction {
  type: 'navigate' | 'click' | 'fill' | 'select' | 'wait' | 'screenshot' | 'assert' | 'hover' | 'scroll' | 'upload';
  selector?: string;
  value?: string;
  timeout?: number;
  assertion?: {
    type: 'visible' | 'hidden' | 'text' | 'value' | 'count' | 'url' | 'title';
    expected?: string | number;
  };
  // For upload actions - auto-generate test data if needed
  generateFile?: {
    type: 'csv' | 'json' | 'image' | 'text';
    schema?: Record<string, string>;
    count?: number;
    filename?: string;
  };
}

let anthropicClient: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!anthropicClient) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

/**
 * Translate natural language test steps into Playwright actions
 */
async function translateStepsToActions(
  steps: string[],
  context: { baseUrl: string; scenarioName: string },
  apiKey?: string
): Promise<PlaywrightAction[]> {
  const client = getClient(apiKey);

  const prompt = `You are a test automation expert. Translate these natural language test steps into Playwright actions.

SCENARIO: ${context.scenarioName}
BASE URL: ${context.baseUrl}

STEPS:
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Respond with a JSON array of actions:
[
  {
    "type": "navigate|click|fill|select|wait|screenshot|assert|hover|scroll|upload",
    "selector": "CSS or text selector (use data-testid when possible, or text='Button Text')",
    "value": "for fill/select/upload actions",
    "timeout": 5000,
    "assertion": {
      "type": "visible|hidden|text|value|count|url|title",
      "expected": "expected value"
    },
    "generateFile": {
      "type": "csv|json|image|text",
      "schema": {"field1": "type", "field2": "type"},
      "count": 10,
      "filename": "test-data"
    }
  }
]

Rules:
1. Start with navigate to baseUrl if needed
2. Use robust selectors: data-testid > role > text > CSS
3. Add wait actions for dynamic content
4. Include assertions to verify outcomes
5. Keep it practical - translate intent, not literally
6. For file uploads: use "generateFile" to auto-create test data
   - Schema field types: id, name, email, phone, address, date, number, price, boolean, status, product, description, url, image

Example selectors:
- "button:has-text('Submit')"
- "[data-testid='login-form']"
- "input[name='email']"
- "text=Welcome back"
- "#main-content"

Example upload with generated CSV:
{
  "type": "upload",
  "selector": "input[type='file']",
  "generateFile": {
    "type": "csv",
    "schema": {"id": "id", "name": "name", "email": "email", "amount": "price"},
    "count": 50
  }
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Failed to translate steps:', error);
  }

  // Fallback: just navigate
  return [{ type: 'navigate', value: context.baseUrl }];
}

/**
 * Execute a single Playwright action
 */
async function executeAction(
  page: Page,
  action: PlaywrightAction,
  config: UITestConfig
): Promise<{ success: boolean; error?: string }> {
  const timeout = action.timeout || config.timeout || 10000;

  try {
    switch (action.type) {
      case 'navigate':
        await page.goto(action.value || config.baseUrl, { timeout });
        break;

      case 'click':
        if (!action.selector) throw new Error('Click requires selector');
        await page.click(action.selector, { timeout });
        break;

      case 'fill':
        if (!action.selector) throw new Error('Fill requires selector');
        await page.fill(action.selector, action.value || '', { timeout });
        break;

      case 'select':
        if (!action.selector) throw new Error('Select requires selector');
        await page.selectOption(action.selector, action.value || '', { timeout });
        break;

      case 'wait':
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout });
        } else {
          await page.waitForTimeout(action.timeout || 1000);
        }
        break;

      case 'hover':
        if (!action.selector) throw new Error('Hover requires selector');
        await page.hover(action.selector, { timeout });
        break;

      case 'scroll':
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout });
        } else {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        break;

      case 'upload':
        if (!action.selector) throw new Error('Upload requires selector');

        let filePath = action.value;

        // Auto-generate test data if requested or if no file provided
        if (action.generateFile || !filePath) {
          const testDataDir = config.testDataDir || './test-data';
          if (!fs.existsSync(testDataDir)) {
            fs.mkdirSync(testDataDir, { recursive: true });
          }

          const gen = action.generateFile || { type: 'csv' as const };
          const filename = gen.filename || `test-upload-${Date.now()}`;

          switch (gen.type) {
            case 'csv': {
              const schema = gen.schema || { id: 'id', name: 'name', email: 'email', value: 'number' };
              const csvContent = generateCSV(schema, gen.count || 10);
              filePath = path.join(testDataDir, `${filename}.csv`);
              fs.writeFileSync(filePath, csvContent);
              break;
            }
            case 'json': {
              const schema = gen.schema || { id: 'id', name: 'name', value: 'number' };
              const { generateJSON } = await import('./testDataAgent.js');
              const jsonData = generateJSON(schema, gen.count || 10);
              filePath = path.join(testDataDir, `${filename}.json`);
              fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
              break;
            }
            case 'image': {
              filePath = path.join(testDataDir, `${filename}.svg`);
              generatePlaceholderImage(200, 200, 'Test', filePath);
              break;
            }
            case 'text':
            default: {
              filePath = path.join(testDataDir, `${filename}.txt`);
              fs.writeFileSync(filePath, `Test file content\nGenerated at: ${new Date().toISOString()}`);
              break;
            }
          }

          console.log(`  Generated test file: ${filePath}`);
        }

        if (!filePath) throw new Error('Upload requires a file path');
        await page.setInputFiles(action.selector, filePath);
        break;

      case 'assert':
        if (!action.assertion) throw new Error('Assert requires assertion object');
        await executeAssertion(page, action, timeout);
        break;

      case 'screenshot':
        // Screenshots are handled by the caller
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an assertion
 */
async function executeAssertion(
  page: Page,
  action: PlaywrightAction,
  timeout: number
): Promise<void> {
  const { assertion, selector } = action;
  if (!assertion) throw new Error('No assertion');

  switch (assertion.type) {
    case 'visible':
      if (!selector) throw new Error('Visible assertion requires selector');
      await page.waitForSelector(selector, { state: 'visible', timeout });
      break;

    case 'hidden':
      if (!selector) throw new Error('Hidden assertion requires selector');
      await page.waitForSelector(selector, { state: 'hidden', timeout });
      break;

    case 'text':
      if (!selector) throw new Error('Text assertion requires selector');
      const textContent = await page.textContent(selector, { timeout });
      if (assertion.expected && !textContent?.includes(String(assertion.expected))) {
        throw new Error(`Expected text "${assertion.expected}" but got "${textContent}"`);
      }
      break;

    case 'value':
      if (!selector) throw new Error('Value assertion requires selector');
      const value = await page.inputValue(selector, { timeout });
      if (assertion.expected && value !== String(assertion.expected)) {
        throw new Error(`Expected value "${assertion.expected}" but got "${value}"`);
      }
      break;

    case 'count':
      if (!selector) throw new Error('Count assertion requires selector');
      const count = await page.locator(selector).count();
      if (assertion.expected !== undefined && count !== assertion.expected) {
        throw new Error(`Expected ${assertion.expected} elements but found ${count}`);
      }
      break;

    case 'url':
      const url = page.url();
      if (assertion.expected && !url.includes(String(assertion.expected))) {
        throw new Error(`Expected URL to contain "${assertion.expected}" but was "${url}"`);
      }
      break;

    case 'title':
      const title = await page.title();
      if (assertion.expected) {
        const expected = String(assertion.expected);
        // Check if it's a regex pattern (starts/ends with / or contains .* or other regex chars)
        const isRegex = expected.startsWith('/') || expected.includes('.*') || expected.includes('\\');
        if (isRegex) {
          // Treat as regex - but .* means "anything" so just pass
          if (expected === '.*' || expected === '/.*/') {
            // Any title is fine
          } else {
            const pattern = expected.replace(/^\/|\/$/g, ''); // Remove leading/trailing slashes
            const regex = new RegExp(pattern, 'i');
            if (!regex.test(title)) {
              throw new Error(`Expected title to match "${expected}" but got "${title}"`);
            }
          }
        } else if (!title.toLowerCase().includes(expected.toLowerCase())) {
          throw new Error(`Expected title "${expected}" but got "${title}"`);
        }
      }
      break;

    default:
      throw new Error(`Unknown assertion type: ${assertion.type}`);
  }
}

/**
 * Run a single test scenario
 */
async function runScenario(
  page: Page,
  scenario: TestPlan['scenarios'][0],
  config: UITestConfig
): Promise<UITestResult> {
  const startTime = Date.now();
  const consoleErrors: string[] = [];

  // Collect console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Translate steps to actions
  const actions = await translateStepsToActions(
    scenario.steps,
    { baseUrl: config.baseUrl, scenarioName: scenario.name },
    config.apiKey
  );

  const stepResults: UITestResult['steps'] = [];
  let passed = true;
  let finalError: string | undefined;

  // Ensure screenshot directory exists
  const screenshotDir = config.screenshotDir || './screenshots';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const stepStart = Date.now();

    const result = await executeAction(page, action, config);

    // Take screenshot after each step
    const screenshotPath = path.join(
      screenshotDir,
      `${scenario.id}-step-${i + 1}.png`
    );
    await page.screenshot({ path: screenshotPath });

    stepResults.push({
      step: scenario.steps[i] || `Action: ${action.type}`,
      action: JSON.stringify(action),
      success: result.success,
      error: result.error,
      screenshot: screenshotPath,
      duration: Date.now() - stepStart,
    });

    if (!result.success) {
      passed = false;
      finalError = result.error;
      break; // Stop on first failure
    }
  }

  // Final screenshot
  const finalScreenshot = path.join(screenshotDir, `${scenario.id}-final.png`);
  await page.screenshot({ path: finalScreenshot, fullPage: true });

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    passed,
    steps: stepResults,
    error: finalError,
    screenshot: finalScreenshot,
    duration: Date.now() - startTime,
    consoleErrors,
  };
}

/**
 * Run all UI tests from a test plan
 */
export async function runUITests(
  testPlan: TestPlan,
  config: UITestConfig
): Promise<UITestSuiteResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: config.headless !== false,
    });

    const results: UITestResult[] = [];

    // Filter to only UI/smoke tests
    const uiScenarios = testPlan.scenarios.filter(
      s => s.type === 'ui' || s.type === 'smoke'
    );

    for (const scenario of uiScenarios) {
      // Create fresh context for each scenario
      const context = await browser.newContext({
        viewport: config.viewport || { width: 1280, height: 720 },
      });
      const page = await context.newPage();

      try {
        const result = await runScenario(page, scenario, config);
        results.push(result);
      } finally {
        await context.close();
      }
    }

    const successful = results.filter(r => r.passed).length;

    return {
      passed: successful === results.length,
      total: results.length,
      successful,
      failed: results.length - successful,
      results,
      duration: Date.now() - startTime,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Quick smoke test - just checks if the app loads
 */
export async function smokeTest(
  baseUrl: string,
  config: Partial<UITestConfig> = {}
): Promise<{ passed: boolean; error?: string; screenshot?: string; consoleErrors: string[] }> {
  let browser: Browser | null = null;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch({
      headless: config.headless !== false,
    });

    const context = await browser.newContext({
      viewport: config.viewport || { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    // Collect console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate
    await page.goto(baseUrl, { timeout: config.timeout || 30000 });

    // Wait for network idle
    await page.waitForLoadState('networkidle', { timeout: config.timeout || 30000 });

    // Take screenshot
    const screenshotDir = config.screenshotDir || './screenshots';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, 'smoke-test.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await context.close();

    // Check for critical console errors
    const criticalErrors = consoleErrors.filter(
      e => e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError')
    );

    return {
      passed: criticalErrors.length === 0,
      error: criticalErrors.length > 0 ? `Console errors: ${criticalErrors.join('; ')}` : undefined,
      screenshot: screenshotPath,
      consoleErrors,
    };
  } catch (error) {
    return {
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      consoleErrors,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Interactive test mode - for debugging
 */
export async function interactiveTest(
  baseUrl: string,
  instructions: string,
  config: Partial<UITestConfig> = {}
): Promise<UITestResult> {
  const scenario = {
    id: 'interactive',
    name: 'Interactive Test',
    description: instructions,
    type: 'ui' as const,
    steps: [instructions],
    expectedOutcome: 'User-defined success',
    priority: 'high' as const,
  };

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false, // Always show browser for interactive
    });

    const context = await browser.newContext({
      viewport: config.viewport || { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    const result = await runScenario(page, scenario, {
      baseUrl,
      ...config,
    } as UITestConfig);

    await context.close();
    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
