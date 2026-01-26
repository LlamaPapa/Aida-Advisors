/**
 * Security Utilities
 *
 * Hardened functions for common operations to prevent:
 * - Path traversal attacks
 * - Shell injection
 * - Unauthenticated webhook access
 * - Network timeouts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ============================================================================
// PATH SECURITY
// ============================================================================

/**
 * Validate that a path is within the allowed root directory.
 * Prevents path traversal attacks like ../../etc/passwd
 */
export function isPathWithinRoot(filePath: string, rootDir: string): boolean {
  const resolvedPath = path.resolve(rootDir, filePath);
  const resolvedRoot = path.resolve(rootDir);
  return resolvedPath.startsWith(resolvedRoot + path.sep) || resolvedPath === resolvedRoot;
}

/**
 * Safely resolve a path, ensuring it stays within the project root.
 * Returns null if path traversal is attempted.
 */
export function safeResolvePath(filePath: string, projectRoot: string): string | null {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const resolved = path.resolve(fullPath);
  const resolvedRoot = path.resolve(projectRoot);

  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    console.warn(`[Security] Blocked path traversal attempt: ${filePath}`);
    return null;
  }

  return resolved;
}

/**
 * Safely read a file, ensuring it's within the project root.
 */
export function safeReadFile(filePath: string, projectRoot: string): string | null {
  const safePath = safeResolvePath(filePath, projectRoot);
  if (!safePath) return null;

  try {
    if (!fs.existsSync(safePath)) return null;
    return fs.readFileSync(safePath, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================================
// SHELL SECURITY
// ============================================================================

/**
 * Escape a string for safe use in shell commands.
 * Use this for any user-provided input going into shell commands.
 */
export function escapeShellArg(arg: string): string {
  // Replace single quotes with escaped version and wrap in single quotes
  // This is the safest way to escape shell arguments
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a string for use in a git commit message.
 * Handles special characters that could cause issues.
 */
export function escapeGitMessage(message: string): string {
  // Remove null bytes and other control characters
  let safe = message.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  // Escape backticks, dollar signs, and backslashes
  safe = safe.replace(/\\/g, '\\\\');
  safe = safe.replace(/`/g, '\\`');
  safe = safe.replace(/\$/g, '\\$');
  safe = safe.replace(/"/g, '\\"');

  return safe;
}

// ============================================================================
// WEBHOOK AUTHENTICATION
// ============================================================================

// Simple token-based auth for webhooks
let webhookSecret: string | null = process.env.UI_DEBUGGER_WEBHOOK_SECRET || null;

/**
 * Set the webhook secret for authentication.
 */
export function setWebhookSecret(secret: string): void {
  webhookSecret = secret;
}

/**
 * Generate a new webhook secret.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate a webhook request.
 * Returns true if auth is disabled (no secret set) or if token is valid.
 */
export function validateWebhookAuth(authHeader: string | undefined): boolean {
  // If no secret is configured, allow all requests (opt-in security)
  if (!webhookSecret) {
    return true;
  }

  if (!authHeader) {
    return false;
  }

  // Support "Bearer <token>" format
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(webhookSecret)
    );
  } catch {
    return false;
  }
}

/**
 * Express middleware for webhook authentication.
 */
export function requireWebhookAuth(
  req: { headers: { authorization?: string } },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: () => void
): void {
  if (validateWebhookAuth(req.headers.authorization)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized - invalid or missing webhook token' });
  }
}

// ============================================================================
// NETWORK UTILITIES
// ============================================================================

export interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

/**
 * Fetch with timeout and retry support.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on abort (timeout) or certain errors
      if (lastError.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }

      // Wait before retrying (exponential backoff)
      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Fetch failed');
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Validate a project root path.
 */
export function validateProjectRoot(projectRoot: unknown): string | null {
  if (typeof projectRoot !== 'string') return null;
  if (projectRoot.length === 0) return null;
  if (projectRoot.length > 1000) return null; // Reasonable limit

  // Must be an absolute path
  if (!path.isAbsolute(projectRoot)) return null;

  // Check for null bytes (path injection)
  if (projectRoot.includes('\0')) return null;

  return projectRoot;
}

/**
 * Validate a URL.
 */
export function validateUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (url.length === 0) return null;
  if (url.length > 2000) return null;

  try {
    const parsed = new URL(url);
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Validate an integer within a range.
 */
export function validateInt(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (value === undefined || value === null) return defaultValue;

  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);

  if (isNaN(num)) return defaultValue;
  if (num < min) return min;
  if (num > max) return max;

  return Math.floor(num);
}

/**
 * Validate a boolean.
 */
export function validateBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return defaultValue;
}

/**
 * Validate a string array.
 */
export function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ============================================================================
// JSON VALIDATION
// ============================================================================

/**
 * Safely parse JSON with a fallback.
 */
export function safeJsonParse<T>(
  json: string,
  fallback: T
): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Extract JSON from a string that might contain extra text.
 */
export function extractJson<T>(
  text: string,
  fallback: T
): T {
  // Try to find JSON object or array
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const arrayMatch = text.match(/\[[\s\S]*\]/);

  const match = objectMatch || arrayMatch;
  if (!match) return fallback;

  return safeJsonParse(match[0], fallback);
}
