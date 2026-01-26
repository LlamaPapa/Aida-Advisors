/**
 * UI Explorer
 *
 * No plans, no commits, no bullshit.
 * Just opens your app and clicks around to find bugs.
 */

import Anthropic from '@anthropic-ai/sdk';
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface ExploreResult {
  success: boolean;
  pagesVisited: number;
  actionsPerformed: number;
  errorsFound: string[];
  consoleErrors: string[];
  screenshots: string[];
  actions: Array<{
    description: string;
    success: boolean;
    error?: string;
    screenshot?: string;
  }>;
  summary: string;
}

interface ExploreConfig {
  baseUrl: string;
  maxActions?: number;
  screenshotDir?: string;
  apiKey?: string;
  headless?: boolean;
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
 * Ask Claude what to do next based on the current page
 */
async function decideNextAction(
  pageHtml: string,
  pageUrl: string,
  previousActions: string[],
  apiKey?: string
): Promise<{ action: string; selector: string; value?: string; description: string } | null> {
  const client = getClient(apiKey);

  const prompt = `You are testing a web application by clicking around and finding bugs.

CURRENT URL: ${pageUrl}

PREVIOUS ACTIONS:
${previousActions.slice(-5).join('\n') || '(none yet)'}

PAGE HTML (truncated):
${pageHtml.slice(0, 15000)}

What should we test next? Pick ONE action.

RESPOND IN THIS EXACT JSON FORMAT:
{
  "action": "click",
  "selector": "THE EXACT TEXT ON THE BUTTON OR LINK",
  "value": "",
  "description": "What we are testing"
}

CRITICAL RULES FOR SELECTOR:
- For buttons: Use the EXACT text shown on the button. Example: "Run Roundtable", "Load", "Submit"
- For links: Use the EXACT link text. Example: "Settings", "Home", "About"
- For inputs: Use the placeholder text or label. Example: "Enter project path", "Search"
- NEVER use CSS selectors like .btn, .action-btn, #submit, [type=button]
- NEVER use class names or IDs
- Just use the human-readable text you see on the element

Actions:
- click: Click something (button, link, tab)
- fill: Type in an input field
- navigate: Go somewhere
- done: Stop testing

Example good responses:
{"action": "click", "selector": "Run Roundtable", "value": "", "description": "Testing the roundtable feature"}
{"action": "click", "selector": "Load Project", "value": "", "description": "Testing project loading"}
{"action": "fill", "selector": "project path", "value": "/test/path", "description": "Entering a test path"}
{"action": "done", "selector": "", "value": "", "description": "Finished testing"}

Look at the HTML and find buttons/links/inputs to interact with. Use their visible text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Failed to decide next action:', error);
  }

  return null;
}

/**
 * Try multiple selector strategies to find and interact with an element
 */
async function findAndClick(page: Page, selector: string, timeout = 3000): Promise<boolean> {
  // Clean up the selector - remove CSS class notation if present
  const cleanSelector = selector.replace(/^\./, '').replace(/-/g, ' ').replace(/\./g, ' ');

  const strategies = [
    // Direct selector (in case it's valid)
    selector,
    // Text-based (most reliable)
    `text="${selector}"`,
    `text="${cleanSelector}"`,
    // Button with text
    `button:has-text("${selector}")`,
    `button:has-text("${cleanSelector}")`,
    // Any clickable with text
    `[role="button"]:has-text("${selector}")`,
    `a:has-text("${selector}")`,
    `div[onclick]:has-text("${selector}")`,
    // Partial text match
    `button >> text=${selector}`,
    `*:has-text("${selector}"):visible >> nth=0`,
    // Aria labels
    `[aria-label="${selector}"]`,
    `[aria-label*="${cleanSelector}" i]`,
    // Title attribute
    `[title="${selector}"]`,
    `[title*="${cleanSelector}" i]`,
    // Data attributes
    `[data-testid="${selector}"]`,
    `[data-action="${selector}"]`,
  ];

  for (const strat of strategies) {
    try {
      const element = page.locator(strat).first();
      if (await element.isVisible({ timeout: 500 })) {
        await element.click({ timeout });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Try multiple strategies to find and fill an input
 */
async function findAndFill(page: Page, selector: string, value: string, timeout = 3000): Promise<boolean> {
  const cleanSelector = selector.replace(/^\./, '').replace(/-/g, ' ');

  const strategies = [
    selector,
    `input[placeholder*="${selector}" i]`,
    `input[placeholder*="${cleanSelector}" i]`,
    `textarea[placeholder*="${selector}" i]`,
    `textarea[placeholder*="${cleanSelector}" i]`,
    `input[name*="${selector}" i]`,
    `[aria-label*="${selector}" i]`,
    `[aria-label*="${cleanSelector}" i]`,
    `input:near(:text("${selector}"))`,
    `textarea:near(:text("${selector}"))`,
    // Try finding any visible input/textarea
    `input:visible >> nth=0`,
    `textarea:visible >> nth=0`,
  ];

  for (const strat of strategies) {
    try {
      const element = page.locator(strat).first();
      if (await element.isVisible({ timeout: 500 })) {
        await element.fill(value, { timeout });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Execute an action on the page
 */
async function executeAction(
  page: Page,
  action: { action: string; selector: string; value?: string; description: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.action) {
      case 'click':
        const clicked = await findAndClick(page, action.selector);
        if (!clicked) {
          // Try one more thing - look for any button/link with similar text
          const fuzzyClicked = await findAndClick(page, action.description.split(' ').slice(-2).join(' '));
          if (!fuzzyClicked) {
            return { success: false, error: `Could not find clickable element: "${action.selector}"` };
          }
        }
        await page.waitForTimeout(1000);
        break;

      case 'fill':
        const filled = await findAndFill(page, action.selector, action.value || 'test input');
        if (!filled) {
          return { success: false, error: `Could not find input field: "${action.selector}"` };
        }
        break;

      case 'select':
        try {
          await page.selectOption(action.selector, action.value || '', { timeout: 3000 });
        } catch {
          return { success: false, error: `Could not find select: "${action.selector}"` };
        }
        break;

      case 'navigate':
        if (action.selector.startsWith('http')) {
          await page.goto(action.selector, { timeout: 10000 });
        } else {
          const navClicked = await findAndClick(page, action.selector);
          if (!navClicked) {
            return { success: false, error: `Could not find navigation: "${action.selector}"` };
          }
        }
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        break;

      case 'done':
        return { success: true };

      default:
        return { success: false, error: `Unknown action: ${action.action}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Main explorer function - just opens your app and clicks around
 */
export async function exploreApp(config: ExploreConfig): Promise<ExploreResult> {
  const {
    baseUrl,
    maxActions = 15,
    screenshotDir = './.ui-debugger/explorer',
    apiKey,
    headless = true,
  } = config;

  // Ensure screenshot directory exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let browser: Browser | null = null;
  const consoleErrors: string[] = [];
  const errorsFound: string[] = [];
  const screenshots: string[] = [];
  const actions: ExploreResult['actions'] = [];
  const previousActions: string[] = [];

  try {
    console.log(`[explorer] Starting exploration of ${baseUrl}`);

    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    // Collect console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        consoleErrors.push(text);
        console.log(`[explorer] Console error: ${text.slice(0, 100)}`);
      }
    });

    // Collect page errors (JavaScript exceptions)
    page.on('pageerror', error => {
      errorsFound.push(`JS Error: ${error.message}`);
      console.log(`[explorer] Page error: ${error.message.slice(0, 100)}`);
    });

    // Collect network errors (404s, 500s, etc.)
    page.on('response', response => {
      const status = response.status();
      if (status >= 400) {
        const url = response.url();
        const errorMsg = `HTTP ${status}: ${url}`;
        consoleErrors.push(errorMsg);
        console.log(`[explorer] Network error: ${errorMsg}`);
      }
    });

    // Collect failed requests (network failures)
    page.on('requestfailed', request => {
      const failure = request.failure();
      const errorMsg = `Request failed: ${request.url()} - ${failure?.errorText || 'unknown error'}`;
      consoleErrors.push(errorMsg);
      console.log(`[explorer] ${errorMsg}`);
    });

    // Navigate to the app
    console.log(`[explorer] Loading ${baseUrl}`);
    await page.goto(baseUrl, { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Take initial screenshot
    const initialScreenshot = path.join(screenshotDir, '00-initial.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });
    screenshots.push(initialScreenshot);
    console.log(`[explorer] Initial page loaded, title: ${await page.title()}`);

    // Explore loop
    let actionCount = 0;
    while (actionCount < maxActions) {
      actionCount++;
      console.log(`[explorer] Action ${actionCount}/${maxActions}`);

      // Get current page state
      const html = await page.content();
      const url = page.url();

      // Ask Claude what to do
      const nextAction = await decideNextAction(html, url, previousActions, apiKey);

      if (!nextAction || nextAction.action === 'done') {
        console.log('[explorer] Claude says we are done exploring');
        break;
      }

      console.log(`[explorer] ${nextAction.description}`);
      previousActions.push(`${nextAction.action}: ${nextAction.description}`);

      // Execute the action
      const result = await executeAction(page, nextAction);

      // Take screenshot
      const screenshotPath = path.join(screenshotDir, `${String(actionCount).padStart(2, '0')}-${nextAction.action}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshots.push(screenshotPath);

      actions.push({
        description: nextAction.description,
        success: result.success,
        error: result.error,
        screenshot: screenshotPath,
      });

      if (!result.success) {
        errorsFound.push(`Action failed: ${nextAction.description} - ${result.error}`);
      }

      // Small delay between actions
      await page.waitForTimeout(500);
    }

    await context.close();

    // Generate summary
    const successCount = actions.filter(a => a.success).length;
    const summary = [
      `Explored ${baseUrl}`,
      `${actions.length} actions performed (${successCount} successful)`,
      `${consoleErrors.length} console errors`,
      `${errorsFound.length} issues found`,
    ].join(' | ');

    console.log(`[explorer] Done: ${summary}`);

    return {
      success: errorsFound.length === 0 && consoleErrors.length === 0,
      pagesVisited: new Set(actions.map(a => a.description)).size,
      actionsPerformed: actions.length,
      errorsFound,
      consoleErrors,
      screenshots,
      actions,
      summary,
    };

  } catch (error) {
    console.error('[explorer] Fatal error:', error);
    return {
      success: false,
      pagesVisited: 0,
      actionsPerformed: actions.length,
      errorsFound: [error instanceof Error ? error.message : String(error)],
      consoleErrors,
      screenshots,
      actions,
      summary: `Exploration failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
