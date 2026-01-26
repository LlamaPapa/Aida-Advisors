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

  const prompt = `You are testing a web application. Based on the current page, decide what to do next.

CURRENT URL: ${pageUrl}

PREVIOUS ACTIONS:
${previousActions.slice(-5).join('\n') || '(none yet)'}

PAGE HTML (truncated):
${pageHtml.slice(0, 15000)}

What should we test next? Pick ONE action:
- click: Click a button, link, or interactive element
- fill: Enter text in an input field
- select: Choose from a dropdown
- navigate: Go to a different page/section
- done: Stop testing (we've covered enough)

Respond in JSON:
{
  "action": "click|fill|select|navigate|done",
  "selector": "CSS selector or text content to find the element",
  "value": "text to enter (for fill/select only)",
  "description": "Human-readable description of what we're testing"
}

Focus on:
1. Main functionality (buttons, forms, navigation)
2. User flows (login, submit, save)
3. Interactive elements we haven't tested yet
4. Don't repeat the same actions`;

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
 * Execute an action on the page
 */
async function executeAction(
  page: Page,
  action: { action: string; selector: string; value?: string; description: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.action) {
      case 'click':
        // Try multiple strategies to find the element
        const clickSelectors = [
          action.selector,
          `text=${action.selector}`,
          `button:has-text("${action.selector}")`,
          `a:has-text("${action.selector}")`,
          `[aria-label="${action.selector}"]`,
        ];

        let clicked = false;
        for (const sel of clickSelectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            clicked = true;
            break;
          } catch {
            continue;
          }
        }

        if (!clicked) {
          return { success: false, error: `Could not find element: ${action.selector}` };
        }

        // Wait for any navigation or updates
        await page.waitForTimeout(1000);
        break;

      case 'fill':
        const fillSelectors = [
          action.selector,
          `input[placeholder*="${action.selector}" i]`,
          `input[name="${action.selector}"]`,
          `textarea[placeholder*="${action.selector}" i]`,
          `[aria-label="${action.selector}"]`,
        ];

        let filled = false;
        for (const sel of fillSelectors) {
          try {
            await page.fill(sel, action.value || 'test input', { timeout: 3000 });
            filled = true;
            break;
          } catch {
            continue;
          }
        }

        if (!filled) {
          return { success: false, error: `Could not find input: ${action.selector}` };
        }
        break;

      case 'select':
        await page.selectOption(action.selector, action.value || '', { timeout: 3000 });
        break;

      case 'navigate':
        if (action.selector.startsWith('http')) {
          await page.goto(action.selector, { timeout: 10000 });
        } else {
          // Try clicking a nav link
          await page.click(`a:has-text("${action.selector}")`, { timeout: 3000 });
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

    // Collect page errors
    page.on('pageerror', error => {
      errorsFound.push(`Page error: ${error.message}`);
      console.log(`[explorer] Page error: ${error.message.slice(0, 100)}`);
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
