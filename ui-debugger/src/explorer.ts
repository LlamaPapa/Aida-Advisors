/**
 * UI Explorer v2
 *
 * Opens your app, scans for interactive elements, clicks around, finds bugs.
 * Now with proper element scanning instead of raw HTML parsing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { scanPage, formatInventoryForPrompt, PageInventory } from './elementScanner.js';

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
 * Ask Claude what to do next based on scanned page elements
 */
async function decideNextAction(
  inventory: PageInventory,
  previousActions: string[],
  apiKey?: string
): Promise<{ action: string; selector: string; value?: string; description: string } | null> {
  const client = getClient(apiKey);

  const inventoryText = formatInventoryForPrompt(inventory);

  const prompt = `You are testing a web application. Here are the interactive elements on the current page:

${inventoryText}

PREVIOUS ACTIONS:
${previousActions.slice(-5).join('\n') || '(none yet)'}

Pick ONE element to interact with. Choose from the lists above.

RESPOND IN JSON:
{
  "action": "click|fill|done",
  "selector": "EXACT text from the lists above",
  "value": "text to type (only for fill)",
  "description": "what we are testing"
}

RULES:
- For "selector", copy the EXACT text from the BUTTONS, LINKS, or INPUT FIELDS lists above
- For inputs, use the placeholder/label text from INPUT FIELDS list
- Don't make up elements - only use what's listed above
- Say "done" when you've tested the main features

Example:
If BUTTONS shows: - "Load Project"
Then respond: {"action": "click", "selector": "Load Project", "value": "", "description": "Testing project loading"}

If INPUT FIELDS shows: - Enter project path
Then respond: {"action": "fill", "selector": "Enter project path", "value": "/test/path", "description": "Testing path input"}`;

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

    // Create context with video recording
    const videoDir = path.join(screenshotDir, 'videos');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 },
      },
    });
    const page = await context.newPage();
    let videoPath: string | undefined;

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

      // Scan page for interactive elements
      const inventory = await scanPage(page);
      console.log(`[explorer] Found: ${inventory.buttons.length} buttons, ${inventory.links.length} links, ${inventory.inputs.length} inputs`);

      // Ask Claude what to do based on scanned elements
      const nextAction = await decideNextAction(inventory, previousActions, apiKey);

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

    // Get video path before closing context
    videoPath = await page.video()?.path();
    await context.close();

    // Log video location
    if (videoPath) {
      console.log(`[explorer] Video saved: ${videoPath}`);
      screenshots.push(videoPath); // Include video in artifacts
    }

    // Generate summary
    const successCount = actions.filter(a => a.success).length;
    const summary = [
      `Explored ${baseUrl}`,
      `${actions.length} actions performed (${successCount} successful)`,
      `${consoleErrors.length} console/network errors`,
      `${errorsFound.length} issues found`,
      videoPath ? `Video: ${path.basename(videoPath)}` : '',
    ].filter(Boolean).join(' | ');

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
