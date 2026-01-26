/**
 * Element Scanner
 *
 * Extracts all interactive elements from a page as structured data.
 * This is what we send to Claude - NOT raw HTML.
 */

import { Page } from 'playwright';

export interface ScannedElement {
  type: 'button' | 'link' | 'input' | 'textarea' | 'select' | 'clickable';
  text: string;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  name?: string;
  href?: string;
  isVisible: boolean;
  isEnabled: boolean;
}

export interface PageInventory {
  url: string;
  title: string;
  buttons: ScannedElement[];
  links: ScannedElement[];
  inputs: ScannedElement[];
  textareas: ScannedElement[];
  selects: ScannedElement[];
  clickables: ScannedElement[];  // divs with onclick, role=button, etc.
}

/**
 * Scan a page and extract all interactive elements
 */
export async function scanPage(page: Page): Promise<PageInventory> {
  const url = page.url();
  const title = await page.title();

  // Extract buttons
  const buttons = await page.$$eval('button', elements =>
    elements.map(el => ({
      type: 'button' as const,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      ariaLabel: el.getAttribute('aria-label') || undefined,
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      isVisible: el.offsetParent !== null,
      isEnabled: !el.disabled,
    }))
  );

  // Extract links
  const links = await page.$$eval('a[href]', elements =>
    elements.map(el => {
      const link = el as HTMLAnchorElement;
      return {
        type: 'link' as const,
        text: (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        href: link.getAttribute('href') || undefined,
        ariaLabel: link.getAttribute('aria-label') || undefined,
        id: link.id || undefined,
        isVisible: link.offsetParent !== null,
        isEnabled: true,
      };
    })
  );

  // Extract inputs
  const inputs = await page.$$eval('input:not([type="hidden"])', elements =>
    elements.map(el => {
      const input = el as HTMLInputElement;
      return {
        type: 'input' as const,
        text: '',
        placeholder: input.placeholder || undefined,
        ariaLabel: input.getAttribute('aria-label') || undefined,
        id: input.id || undefined,
        name: input.name || undefined,
        isVisible: input.offsetParent !== null,
        isEnabled: !input.disabled,
      };
    })
  );

  // Extract textareas
  const textareas = await page.$$eval('textarea', elements =>
    elements.map(el => ({
      type: 'textarea' as const,
      text: '',
      placeholder: el.placeholder || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      id: el.id || undefined,
      name: el.name || undefined,
      isVisible: el.offsetParent !== null,
      isEnabled: !el.disabled,
    }))
  );

  // Extract selects
  const selects = await page.$$eval('select', elements =>
    elements.map(el => ({
      type: 'select' as const,
      text: '',
      ariaLabel: el.getAttribute('aria-label') || undefined,
      id: el.id || undefined,
      name: el.name || undefined,
      isVisible: el.offsetParent !== null,
      isEnabled: !el.disabled,
    }))
  );

  // Extract clickable divs (role=button, onclick, etc.)
  const clickables = await page.$$eval('[role="button"], [onclick], [tabindex="0"]', elements =>
    elements
      .filter(el => el.tagName.toLowerCase() !== 'button' && el.tagName.toLowerCase() !== 'a')
      .map(el => {
        const elem = el as HTMLElement;
        return {
          type: 'clickable' as const,
          text: (elem.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
          ariaLabel: elem.getAttribute('aria-label') || undefined,
          id: elem.id || undefined,
          isVisible: elem.offsetParent !== null,
          isEnabled: true,
        };
      })
  );

  return {
    url,
    title,
    buttons: buttons.filter(b => b.isVisible && b.text),
    links: links.filter(l => l.isVisible && l.text),
    inputs: inputs.filter(i => i.isVisible),
    textareas: textareas.filter(t => t.isVisible),
    selects: selects.filter(s => s.isVisible),
    clickables: clickables.filter(c => c.isVisible && c.text),
  };
}

/**
 * Format inventory for Claude - simple list of what can be interacted with
 */
export function formatInventoryForPrompt(inventory: PageInventory): string {
  const lines: string[] = [];

  lines.push(`Page: ${inventory.title}`);
  lines.push(`URL: ${inventory.url}`);
  lines.push('');

  if (inventory.buttons.length > 0) {
    lines.push('BUTTONS:');
    inventory.buttons.forEach(b => {
      lines.push(`  - "${b.text}"${b.ariaLabel ? ` (aria: ${b.ariaLabel})` : ''}`);
    });
    lines.push('');
  }

  if (inventory.links.length > 0) {
    lines.push('LINKS:');
    inventory.links.forEach(l => {
      lines.push(`  - "${l.text}"${l.href ? ` → ${l.href.slice(0, 50)}` : ''}`);
    });
    lines.push('');
  }

  if (inventory.inputs.length > 0) {
    lines.push('INPUT FIELDS:');
    inventory.inputs.forEach(i => {
      const label = i.placeholder || i.ariaLabel || i.name || i.id || 'unlabeled';
      lines.push(`  - ${label}`);
    });
    lines.push('');
  }

  if (inventory.textareas.length > 0) {
    lines.push('TEXT AREAS:');
    inventory.textareas.forEach(t => {
      const label = t.placeholder || t.ariaLabel || t.name || t.id || 'unlabeled';
      lines.push(`  - ${label}`);
    });
    lines.push('');
  }

  if (inventory.clickables.length > 0) {
    lines.push('OTHER CLICKABLE ELEMENTS:');
    inventory.clickables.forEach(c => {
      lines.push(`  - "${c.text}"`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Find an element by its text (used after Claude picks what to click)
 */
export async function findElementByText(page: Page, text: string): Promise<boolean> {
  const normalizedText = text.toLowerCase().trim();

  // Try multiple strategies
  const strategies = [
    // Exact text match
    `text="${text}"`,
    // Button with text
    `button:has-text("${text}")`,
    // Link with text
    `a:has-text("${text}")`,
    // Role button with text
    `[role="button"]:has-text("${text}")`,
    // Any element with text (less specific)
    `*:has-text("${text}"):visible`,
  ];

  for (const strategy of strategies) {
    try {
      const locator = page.locator(strategy).first();
      if (await locator.isVisible({ timeout: 1000 })) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
