/**
 * UI Test Spec
 *
 * Structured format for UI tests that vibecoder generates
 * and ui-debugger executes.
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { generateUsers, generateProducts, generateCSV, generatePlaceholderImage } from './testDataAgent.js';

// ============================================
// TEST SPEC FORMAT
// ============================================

export interface UITestSpec {
  name: string;
  description?: string;
  baseUrl: string;

  // Test scenarios
  scenarios: TestScenario[];

  // Optional: data this test needs
  testData?: TestDataRequirement;

  // Optional: setup before all tests
  setup?: TestStep[];

  // Optional: teardown after all tests
  teardown?: TestStep[];
}

export interface TestScenario {
  name: string;
  description?: string;
  steps: TestStep[];

  // What proves this scenario passed
  verify: VerifyCondition[];
}

export type TestStep =
  | { action: 'navigate'; path: string }
  | { action: 'click'; target: string }
  | { action: 'fill'; target: string; value: string }
  | { action: 'select'; target: string; value: string }
  | { action: 'upload'; target: string; file: string | { generate: 'csv' | 'json' | 'image'; schema?: Record<string, string>; count?: number } }
  | { action: 'wait'; ms?: number; for?: string }
  | { action: 'hover'; target: string }
  | { action: 'scroll'; target?: string; to?: 'top' | 'bottom' }
  | { action: 'press'; key: string }
  | { action: 'screenshot'; name?: string };

export type VerifyCondition =
  | { check: 'url'; contains?: string; equals?: string }
  | { check: 'visible'; target: string }
  | { check: 'hidden'; target: string }
  | { check: 'text'; target: string; contains?: string; equals?: string }
  | { check: 'value'; target: string; equals: string }
  | { check: 'count'; target: string; equals: number }
  | { check: 'title'; contains?: string; equals?: string }
  | { check: 'noErrors' };

export interface TestDataRequirement {
  users?: number;
  products?: number;
  csv?: { filename: string; schema: Record<string, string>; count: number };
  images?: number;
}

// ============================================
// SPEC EXECUTION
// ============================================

export interface SpecRunResult {
  spec: string;
  passed: boolean;
  scenarios: ScenarioResult[];
  duration: number;
  screenshots: string[];
  errors: string[];
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
  verifications: VerificationResult[];
  duration: number;
  error?: string;
}

export interface StepResult {
  action: string;
  passed: boolean;
  duration: number;
  error?: string;
  screenshot?: string;
}

export interface VerificationResult {
  check: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  error?: string;
}

// ============================================
// SPEC RUNNER
// ============================================

export async function runSpec(
  spec: UITestSpec,
  options: {
    headless?: boolean;
    screenshotDir?: string;
    testDataDir?: string;
    timeout?: number;
  } = {}
): Promise<SpecRunResult> {
  const startTime = Date.now();
  const screenshotDir = options.screenshotDir || './screenshots';
  const testDataDir = options.testDataDir || './test-data';
  const timeout = options.timeout || 10000;

  // Ensure directories exist
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(testDataDir, { recursive: true });

  const result: SpecRunResult = {
    spec: spec.name,
    passed: true,
    scenarios: [],
    duration: 0,
    screenshots: [],
    errors: [],
  };

  let browser: Browser | null = null;

  try {
    // Generate test data if needed
    const generatedData = await generateTestData(spec.testData, testDataDir);

    // Launch browser
    browser = await chromium.launch({
      headless: options.headless !== false,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Collect console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Run setup if defined
    if (spec.setup) {
      for (const step of spec.setup) {
        await executeStep(page, step, spec.baseUrl, { timeout, testDataDir, generatedData });
      }
    }

    // Run each scenario
    for (const scenario of spec.scenarios) {
      const scenarioResult = await runScenario(
        page,
        scenario,
        spec.baseUrl,
        { timeout, screenshotDir, testDataDir, generatedData, consoleErrors }
      );

      result.scenarios.push(scenarioResult);
      result.screenshots.push(...scenarioResult.steps.filter(s => s.screenshot).map(s => s.screenshot!));

      if (!scenarioResult.passed) {
        result.passed = false;
        if (scenarioResult.error) {
          result.errors.push(`${scenario.name}: ${scenarioResult.error}`);
        }
      }
    }

    // Run teardown if defined
    if (spec.teardown) {
      for (const step of spec.teardown) {
        await executeStep(page, step, spec.baseUrl, { timeout, testDataDir, generatedData });
      }
    }

    // Check for console errors
    if (consoleErrors.length > 0) {
      result.errors.push(...consoleErrors.map(e => `Console: ${e}`));
    }

    await context.close();

  } catch (error) {
    result.passed = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

async function runScenario(
  page: Page,
  scenario: TestScenario,
  baseUrl: string,
  options: {
    timeout: number;
    screenshotDir: string;
    testDataDir: string;
    generatedData: GeneratedData;
    consoleErrors: string[];
  }
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const result: ScenarioResult = {
    name: scenario.name,
    passed: true,
    steps: [],
    verifications: [],
    duration: 0,
  };

  // Execute steps
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepStart = Date.now();

    try {
      await executeStep(page, step, baseUrl, options);

      // Take screenshot after each step
      const screenshotPath = path.join(
        options.screenshotDir,
        `${scenario.name.replace(/\s+/g, '-')}-step-${i + 1}.png`
      );
      await page.screenshot({ path: screenshotPath });

      result.steps.push({
        action: JSON.stringify(step),
        passed: true,
        duration: Date.now() - stepStart,
        screenshot: screenshotPath,
      });

    } catch (error) {
      result.passed = false;
      result.error = error instanceof Error ? error.message : String(error);
      result.steps.push({
        action: JSON.stringify(step),
        passed: false,
        duration: Date.now() - stepStart,
        error: result.error,
      });
      break; // Stop on first failure
    }
  }

  // Run verifications only if steps passed
  if (result.passed) {
    for (const verify of scenario.verify) {
      const verifyResult = await runVerification(page, verify, options);
      result.verifications.push(verifyResult);

      if (!verifyResult.passed) {
        result.passed = false;
        result.error = verifyResult.error;
      }
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

async function executeStep(
  page: Page,
  step: TestStep,
  baseUrl: string,
  options: { timeout: number; testDataDir: string; generatedData: GeneratedData }
): Promise<void> {
  const { timeout, testDataDir, generatedData } = options;

  switch (step.action) {
    case 'navigate':
      const url = step.path.startsWith('http') ? step.path : `${baseUrl}${step.path}`;
      await page.goto(url, { timeout });
      break;

    case 'click':
      await page.click(resolveSelector(step.target), { timeout });
      break;

    case 'fill':
      await page.fill(resolveSelector(step.target), resolveValue(step.value, generatedData), { timeout });
      break;

    case 'select':
      await page.selectOption(resolveSelector(step.target), step.value, { timeout });
      break;

    case 'upload':
      let filePath: string;
      if (typeof step.file === 'string') {
        filePath = step.file;
      } else {
        // Generate file
        filePath = await generateUploadFile(step.file, testDataDir);
      }
      await page.setInputFiles(resolveSelector(step.target), filePath);
      break;

    case 'wait':
      if (step.for) {
        await page.waitForSelector(resolveSelector(step.for), { timeout });
      } else {
        await page.waitForTimeout(step.ms || 1000);
      }
      break;

    case 'hover':
      await page.hover(resolveSelector(step.target), { timeout });
      break;

    case 'scroll':
      if (step.target) {
        await page.locator(resolveSelector(step.target)).scrollIntoViewIfNeeded({ timeout });
      } else if (step.to === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else {
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      break;

    case 'press':
      await page.keyboard.press(step.key);
      break;

    case 'screenshot':
      // Handled by caller
      break;
  }
}

async function runVerification(
  page: Page,
  verify: VerifyCondition,
  options: { timeout: number; consoleErrors: string[] }
): Promise<VerificationResult> {
  const { timeout, consoleErrors } = options;

  try {
    switch (verify.check) {
      case 'url': {
        const url = page.url();
        if (verify.contains && !url.includes(verify.contains)) {
          return { check: 'url', passed: false, expected: verify.contains, actual: url, error: `URL doesn't contain "${verify.contains}"` };
        }
        if (verify.equals && url !== verify.equals) {
          return { check: 'url', passed: false, expected: verify.equals, actual: url, error: `URL doesn't equal "${verify.equals}"` };
        }
        return { check: 'url', passed: true };
      }

      case 'visible': {
        await page.waitForSelector(resolveSelector(verify.target), { state: 'visible', timeout });
        return { check: 'visible', passed: true };
      }

      case 'hidden': {
        await page.waitForSelector(resolveSelector(verify.target), { state: 'hidden', timeout });
        return { check: 'hidden', passed: true };
      }

      case 'text': {
        const text = await page.textContent(resolveSelector(verify.target), { timeout });
        if (verify.contains && !text?.includes(verify.contains)) {
          return { check: 'text', passed: false, expected: verify.contains, actual: text || '', error: `Text doesn't contain "${verify.contains}"` };
        }
        if (verify.equals && text !== verify.equals) {
          return { check: 'text', passed: false, expected: verify.equals, actual: text || '', error: `Text doesn't equal "${verify.equals}"` };
        }
        return { check: 'text', passed: true };
      }

      case 'value': {
        const value = await page.inputValue(resolveSelector(verify.target), { timeout });
        if (value !== verify.equals) {
          return { check: 'value', passed: false, expected: verify.equals, actual: value, error: `Value doesn't equal "${verify.equals}"` };
        }
        return { check: 'value', passed: true };
      }

      case 'count': {
        const count = await page.locator(resolveSelector(verify.target)).count();
        if (count !== verify.equals) {
          return { check: 'count', passed: false, expected: String(verify.equals), actual: String(count), error: `Expected ${verify.equals} elements, found ${count}` };
        }
        return { check: 'count', passed: true };
      }

      case 'title': {
        const title = await page.title();
        if (verify.contains && !title.includes(verify.contains)) {
          return { check: 'title', passed: false, expected: verify.contains, actual: title, error: `Title doesn't contain "${verify.contains}"` };
        }
        if (verify.equals && title !== verify.equals) {
          return { check: 'title', passed: false, expected: verify.equals, actual: title, error: `Title doesn't equal "${verify.equals}"` };
        }
        return { check: 'title', passed: true };
      }

      case 'noErrors': {
        const criticalErrors = consoleErrors.filter(e =>
          e.includes('TypeError') || e.includes('ReferenceError') || e.includes('SyntaxError')
        );
        if (criticalErrors.length > 0) {
          return { check: 'noErrors', passed: false, error: `Console errors: ${criticalErrors.join('; ')}` };
        }
        return { check: 'noErrors', passed: true };
      }

      default:
        return { check: 'unknown', passed: false, error: 'Unknown verification type' };
    }
  } catch (error) {
    return {
      check: verify.check,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// HELPERS
// ============================================

interface GeneratedData {
  users?: Array<{ email: string; password: string; name: string }>;
  products?: Array<{ name: string; price: number }>;
  files?: Record<string, string>;
}

async function generateTestData(
  requirements: TestDataRequirement | undefined,
  testDataDir: string
): Promise<GeneratedData> {
  const data: GeneratedData = {};

  if (!requirements) return data;

  if (requirements.users) {
    data.users = [];
    for (let i = 0; i < requirements.users; i++) {
      data.users.push({
        email: `testuser${i + 1}@example.com`,
        password: 'TestPass123!',
        name: `Test User ${i + 1}`,
      });
    }
  }

  if (requirements.products) {
    const products = generateProducts(requirements.products);
    data.products = products as Array<{ name: string; price: number }>;
  }

  if (requirements.csv) {
    const csvContent = generateCSV(requirements.csv.schema, requirements.csv.count);
    const filePath = path.join(testDataDir, requirements.csv.filename);
    fs.writeFileSync(filePath, csvContent);
    data.files = data.files || {};
    data.files[requirements.csv.filename] = filePath;
  }

  if (requirements.images) {
    data.files = data.files || {};
    for (let i = 0; i < requirements.images; i++) {
      const filePath = path.join(testDataDir, `test-image-${i + 1}.svg`);
      generatePlaceholderImage(200, 200, `Test ${i + 1}`, filePath);
      data.files[`image-${i + 1}`] = filePath;
    }
  }

  return data;
}

async function generateUploadFile(
  config: { generate: 'csv' | 'json' | 'image'; schema?: Record<string, string>; count?: number },
  testDataDir: string
): Promise<string> {
  const filename = `upload-${Date.now()}`;

  switch (config.generate) {
    case 'csv': {
      const schema = config.schema || { id: 'id', name: 'name', value: 'number' };
      const content = generateCSV(schema, config.count || 10);
      const filePath = path.join(testDataDir, `${filename}.csv`);
      fs.writeFileSync(filePath, content);
      return filePath;
    }
    case 'json': {
      const schema = config.schema || { id: 'id', name: 'name', value: 'number' };
      const { generateJSON } = await import('./testDataAgent.js');
      const content = generateJSON(schema, config.count || 10);
      const filePath = path.join(testDataDir, `${filename}.json`);
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      return filePath;
    }
    case 'image': {
      const filePath = path.join(testDataDir, `${filename}.svg`);
      generatePlaceholderImage(200, 200, 'Upload', filePath);
      return filePath;
    }
  }
}

function resolveSelector(target: string): string {
  // Support shortcuts
  if (target.startsWith('@')) {
    // @button-login -> [data-testid="button-login"]
    return `[data-testid="${target.slice(1)}"]`;
  }
  if (target.startsWith('text=') || target.startsWith('button:') || target.startsWith('input[') || target.startsWith('#') || target.startsWith('.')) {
    return target;
  }
  // Assume it's a text selector
  return `text="${target}"`;
}

function resolveValue(value: string, data: GeneratedData): string {
  // Support data references
  if (value.startsWith('$user.')) {
    const field = value.slice(6) as keyof GeneratedData['users'][0];
    return data.users?.[0]?.[field] || value;
  }
  if (value.startsWith('$product.')) {
    const field = value.slice(9);
    return String((data.products?.[0] as any)?.[field] || value);
  }
  return value;
}

// ============================================
// SPEC LOADER
// ============================================

export function loadSpec(filePath: string): UITestSpec {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function validateSpec(spec: any): spec is UITestSpec {
  if (!spec.name || typeof spec.name !== 'string') return false;
  if (!spec.baseUrl || typeof spec.baseUrl !== 'string') return false;
  if (!Array.isArray(spec.scenarios)) return false;

  for (const scenario of spec.scenarios) {
    if (!scenario.name || !Array.isArray(scenario.steps) || !Array.isArray(scenario.verify)) {
      return false;
    }
  }

  return true;
}
