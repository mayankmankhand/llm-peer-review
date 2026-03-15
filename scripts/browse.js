#!/usr/bin/env node

/**
 * Browse - Headless Browser QA Script
 *
 * Standalone Node.js script for running headless browser sessions.
 * Reads a JSON action sequence from stdin, launches a browser, executes
 * each action in order, and returns structured JSON results.
 *
 * Intentionally kept as a standalone script (same pattern as ask-gpt.js
 * and ask-gemini.js) for independent debugging and simple invocation.
 *
 * Usage:
 *   cat actions.json | node scripts/browse.js
 *   echo '{"actions":[...]}' | node scripts/browse.js
 *   node scripts/browse.js --help
 *
 * Input (JSON via stdin):
 *   {
 *     "baseUrl": "http://localhost:3000",
 *     "actions": [
 *       { "type": "goto", "url": "/" },
 *       { "type": "screenshot" },
 *       { "type": "text" }
 *     ]
 *   }
 *
 * Output (JSON to stdout):
 *   {
 *     "ok": true,
 *     "actions": [...],
 *     "console": [...],
 *     "network": [...],
 *     "errors": [...]
 *   }
 *
 * Scope & Assumptions:
 *   - Designed for Linux/WSL environments
 *   - Requires playwright-core and Chromium binary installed separately
 *   - Single-session model: one browser launch per invocation
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  navigationTimeoutMs: 10000,
  actionTimeoutMs: 5000,
  maxTextLength: 50 * 1024, // 50KB
  screenshotDir: '/tmp',
  screenshotPrefix: 'browse-screenshot',
  defaultBaseUrl: 'http://localhost:3000',
};

// Supported action types
const VALID_ACTIONS = ['goto', 'click', 'fill', 'screenshot', 'text', 'wait'];

// ── Error messages ─────────────────────────────────────────────────────────

const ERR = {
  NO_INPUT: 'No JSON input received on stdin. Pipe a JSON file: cat actions.json | node scripts/browse.js',
  INVALID_JSON: (msg) => `Invalid JSON input: ${msg}`,
  NO_ACTIONS: 'Input must include an "actions" array with at least one action.',
  FIRST_MUST_BE_GOTO: 'First action must be "goto" so the browser knows where to navigate.',
  UNKNOWN_ACTION: (type) => `Unknown action type: "${type}". Supported: ${VALID_ACTIONS.join(', ')}`,
  MISSING_FIELD: (action, field) => `Action "${action}" requires a "${field}" field.`,
  BROWSER_NOT_FOUND: `Chromium not found. Install it with:\n  npx playwright-core install chromium\n\nOn WSL/Linux, also run:\n  sudo npx playwright-core install-deps chromium`,
  LAUNCH_FAILED: (msg) => `Browser failed to launch: ${msg}`,
  UNSAFE_URL: (url) => `Blocked navigation to "${url}". Only http: and https: URLs are allowed. Use baseUrl for local dev servers.`,
  NAVIGATION_FAILED: (url, msg) => `Failed to navigate to ${url}: ${msg}`,
  SELECTOR_FAILED: (target, msg) => `Could not find element "${target}": ${msg}`,
  TIMEOUT: (action, ms) => `${action} timed out after ${ms}ms. Is the page fully loaded?`,
};

// ── Selector resolution ────────────────────────────────────────────────────

/**
 * Resolve a target string into a Playwright locator.
 *
 * Supported prefixes:
 *   css:.my-class      - CSS selector
 *   text:Click me      - Text content (substring match)
 *   role:button:Submit  - ARIA role with name
 *
 * If no prefix is given, treats it as a CSS selector.
 */
function resolveLocator(page, target) {
  if (target.startsWith('css:')) {
    return page.locator(target.slice(4));
  }
  if (target.startsWith('text:')) {
    return page.getByText(target.slice(5));
  }
  if (target.startsWith('role:')) {
    const parts = target.slice(5).split(':');
    const role = parts[0];
    const name = parts.slice(1).join(':'); // rejoin in case name has colons
    if (name) {
      return page.getByRole(role, { name });
    }
    return page.getByRole(role);
  }
  // Default: treat as CSS selector
  return page.locator(target);
}

// ── Action handlers ────────────────────────────────────────────────────────

/**
 * Navigate to a URL. Must be the first action in every session.
 * Resolves relative URLs against baseUrl.
 */
async function handleGoto(page, action, baseUrl) {
  const url = action.url || '/';
  // Only http: and https: are allowed as absolute URLs; relative paths resolve against baseUrl
  const isAbsolute = /^https?:\/\//i.test(url);
  const fullUrl = isAbsolute ? url : `${baseUrl}${url}`;

  // Block non-http schemes (file:, data:, javascript:, etc.)
  if (!/^https?:\/\//i.test(fullUrl)) {
    return { type: 'goto', ok: false, url: fullUrl, error: ERR.UNSAFE_URL(fullUrl) };
  }

  try {
    const response = await page.goto(fullUrl, {
      timeout: CONFIG.navigationTimeoutMs,
      waitUntil: 'domcontentloaded',
    });

    // Give the page a moment for initial JS rendering
    await page.waitForTimeout(500);

    const title = await page.title();
    const status = response ? response.status() : null;

    return {
      type: 'goto',
      ok: true,
      url: fullUrl,
      status,
      title,
    };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { type: 'goto', ok: false, url: fullUrl, error: ERR.TIMEOUT('goto', CONFIG.navigationTimeoutMs) };
    }
    return { type: 'goto', ok: false, url: fullUrl, error: ERR.NAVIGATION_FAILED(fullUrl, err.message.split('\n').slice(0, 3).join(' | ')) };
  }
}

/**
 * Click an element on the page.
 * Uses the selector prefix syntax (css:, text:, role:).
 */
async function handleClick(page, action) {
  const target = action.target;
  if (!target) {
    return { type: 'click', ok: false, error: ERR.MISSING_FIELD('click', 'target') };
  }

  try {
    const locator = resolveLocator(page, target);
    await locator.click({ timeout: CONFIG.actionTimeoutMs });
    // Wait briefly for any navigation or rendering triggered by the click
    await page.waitForTimeout(300);
    return { type: 'click', ok: true, target };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { type: 'click', ok: false, target, error: ERR.TIMEOUT('click', CONFIG.actionTimeoutMs) };
    }
    return { type: 'click', ok: false, target, error: ERR.SELECTOR_FAILED(target, err.message.split('\n').slice(0, 3).join(' | ')) };
  }
}

/**
 * Fill a text input with a value.
 * Uses the selector prefix syntax (css:, text:, role:).
 */
async function handleFill(page, action) {
  const target = action.target;
  const value = action.value;
  if (!target) {
    return { type: 'fill', ok: false, error: ERR.MISSING_FIELD('fill', 'target') };
  }
  if (value === undefined || value === null) {
    return { type: 'fill', ok: false, error: ERR.MISSING_FIELD('fill', 'value') };
  }

  try {
    const locator = resolveLocator(page, target);
    await locator.fill(String(value), { timeout: CONFIG.actionTimeoutMs });
    return { type: 'fill', ok: true, target, value };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { type: 'fill', ok: false, target, error: ERR.TIMEOUT('fill', CONFIG.actionTimeoutMs) };
    }
    return { type: 'fill', ok: false, target, error: ERR.SELECTOR_FAILED(target, err.message.split('\n').slice(0, 3).join(' | ')) };
  }
}

/**
 * Take a full-page screenshot and save to /tmp.
 * Returns the file path so Claude can read it with the Read tool.
 */
async function handleScreenshot(page, action) {
  const timestamp = Date.now();
  const filename = `${CONFIG.screenshotPrefix}-${timestamp}.png`;
  const filepath = path.join(CONFIG.screenshotDir, filename);

  try {
    await page.screenshot({
      path: filepath,
      fullPage: action.fullPage !== false, // default to full page
      timeout: CONFIG.actionTimeoutMs,
    });
    return { type: 'screenshot', ok: true, path: filepath };
  } catch (err) {
    return { type: 'screenshot', ok: false, error: `Screenshot failed: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
  }
}

/**
 * Extract visible text from the page or a specific element.
 *
 * Uses innerText which returns only visible text, collapses whitespace,
 * and excludes hidden elements. Truncates at 50KB with a note.
 */
async function handleText(page, action) {
  try {
    let text;
    const target = action.target;

    if (target) {
      const locator = resolveLocator(page, target);
      text = await locator.innerText({ timeout: CONFIG.actionTimeoutMs });
    } else {
      text = await page.evaluate(() => document.body.innerText);
    }

    let truncated = false;
    if (text.length > CONFIG.maxTextLength) {
      text = text.slice(0, CONFIG.maxTextLength);
      truncated = true;
    }

    const result = { type: 'text', ok: true, text };
    if (target) result.target = target;
    if (truncated) result.truncated = true;
    return result;
  } catch (err) {
    const result = { type: 'text', ok: false, error: `Text extraction failed: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
    if (action.target) result.target = action.target;
    return result;
  }
}

/**
 * Wait for a specified time or for a selector to appear.
 * Supports: { "type": "wait", "ms": 2000 } or { "type": "wait", "selector": "css:.loaded" }
 */
async function handleWait(page, action) {
  try {
    if (action.selector) {
      const locator = resolveLocator(page, action.selector);
      await locator.waitFor({ timeout: action.ms || CONFIG.actionTimeoutMs });
      return { type: 'wait', ok: true, selector: action.selector };
    }

    const ms = action.ms || 1000;
    await page.waitForTimeout(ms);
    return { type: 'wait', ok: true, ms };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { type: 'wait', ok: false, error: ERR.TIMEOUT('wait', action.ms || CONFIG.actionTimeoutMs) };
    }
    return { type: 'wait', ok: false, error: `Wait failed: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
  }
}

// ── Input validation ───────────────────────────────────────────────────────

/**
 * Validate the input JSON payload.
 * Returns { ok: true, data } or { ok: false, error }.
 */
function validateInput(input) {
  let data;
  try {
    data = JSON.parse(input);
  } catch (err) {
    return { ok: false, error: ERR.INVALID_JSON(err.message) };
  }

  if (!data.actions || !Array.isArray(data.actions) || data.actions.length === 0) {
    return { ok: false, error: ERR.NO_ACTIONS };
  }

  if (data.actions[0].type !== 'goto') {
    return { ok: false, error: ERR.FIRST_MUST_BE_GOTO };
  }

  for (const action of data.actions) {
    if (!VALID_ACTIONS.includes(action.type)) {
      return { ok: false, error: ERR.UNKNOWN_ACTION(action.type) };
    }
  }

  return { ok: true, data };
}

// ── Diagnostic collectors ──────────────────────────────────────────────────

/**
 * Set up passive diagnostic collection on a page.
 * Captures console messages, page errors, and failed network requests.
 */
function setupDiagnostics(page) {
  const diagnostics = {
    console: [],
    errors: [],
    network: [],
  };

  // Console messages (errors and warnings only to keep output focused)
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      diagnostics.console.push({
        type,
        text: msg.text().slice(0, 1000), // cap individual messages
      });
    }
  });

  // Uncaught page errors (exceptions not caught by the app)
  page.on('pageerror', (err) => {
    diagnostics.errors.push({
      type: 'pageerror',
      text: err.message.slice(0, 1000),
    });
  });

  // Failed network requests (DNS, CORS, connection issues)
  page.on('requestfailed', (request) => {
    diagnostics.network.push({
      url: request.url(),
      method: request.method(),
      error: request.failure()?.errorText || 'Unknown failure',
    });
  });

  // HTTP error responses (4xx, 5xx)
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.network.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
      });
    }
  });

  return diagnostics;
}

// ── Main execution ─────────────────────────────────────────────────────────

/**
 * Read all of stdin into a string.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    // If stdin is a TTY (no pipe), return empty immediately
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * Run a browser session with the given actions.
 */
async function runSession(data) {
  const baseUrl = data.baseUrl || CONFIG.defaultBaseUrl;
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    const msg = err.message || '';
    // Detect missing browser binary
    if (msg.includes('Executable doesn\'t exist') || msg.includes('browserType.launch')) {
      return { ok: false, error: ERR.BROWSER_NOT_FOUND };
    }
    return { ok: false, error: ERR.LAUNCH_FAILED(msg.split('\n')[0]) };
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = setupDiagnostics(page);
  const actionResults = [];

  // Action dispatch table
  const handlers = {
    goto: (action) => handleGoto(page, action, baseUrl),
    click: (action) => handleClick(page, action),
    fill: (action) => handleFill(page, action),
    screenshot: (action) => handleScreenshot(page, action),
    text: (action) => handleText(page, action),
    wait: (action) => handleWait(page, action),
  };

  // Execute each action in sequence
  for (const action of data.actions) {
    const handler = handlers[action.type];
    const result = await handler(action);
    actionResults.push(result);

    // Stop on failure - no point continuing if the page is broken
    if (!result.ok) {
      break;
    }
  }

  await browser.close();

  // Build the final output
  const allOk = actionResults.every((r) => r.ok);
  const lastGoto = actionResults.filter((r) => r.type === 'goto' && r.ok).pop();

  const output = {
    ok: allOk,
    actions: actionResults,
  };

  // Include final page state if we navigated somewhere
  if (lastGoto) {
    output.url = lastGoto.url;
    output.title = lastGoto.title;
  }

  // Include diagnostics (only if there's something to report)
  if (diagnostics.console.length > 0) output.console = diagnostics.console;
  if (diagnostics.network.length > 0) output.network = diagnostics.network;
  if (diagnostics.errors.length > 0) output.errors = diagnostics.errors;

  return output;
}

/**
 * Print help message.
 */
function printHelp() {
  console.log(`
Browse - Headless Browser QA Script

Launches a headless browser, runs a sequence of actions, and returns
structured JSON results. Designed for Claude to use during /review-browser.

Usage:
  cat actions.json | node scripts/browse.js
  echo '<json>' | node scripts/browse.js
  node scripts/browse.js --help

Input format (JSON via stdin):
  {
    "baseUrl": "http://localhost:3000",
    "actions": [
      { "type": "goto", "url": "/" },
      { "type": "click", "target": "text:Login" },
      { "type": "fill", "target": "css:input[name=email]", "value": "user@test.com" },
      { "type": "screenshot" },
      { "type": "text" },
      { "type": "text", "target": "css:.main-content" },
      { "type": "wait", "ms": 2000 },
      { "type": "wait", "selector": "css:.loaded" }
    ]
  }

Action types:
  goto        Navigate to a URL (must be first action)
              Fields: url (resolved against baseUrl)
  click       Click an element
              Fields: target (selector with prefix)
  fill        Type text into an input
              Fields: target (selector with prefix), value
  screenshot  Take a full-page screenshot (saved to /tmp)
  text        Extract visible text from page or element
              Fields: target (optional, scoped extraction)
  wait        Wait for time or element
              Fields: ms (milliseconds) or selector

Selector prefixes:
  css:.my-class          CSS selector
  text:Click me          Text content match
  role:button:Submit     ARIA role with name
  .my-class              No prefix = CSS selector

Options:
  --help      Show this help message
`);
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  // Handle --help
  if (process.argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  // Read JSON from stdin
  const input = await readStdin();
  if (!input.trim()) {
    console.error(`\n${ERR.NO_INPUT}\n`);
    process.exit(1);
  }

  // Validate input
  const validation = validateInput(input);
  if (!validation.ok) {
    // Output validation errors as JSON so Claude can parse them
    console.log(JSON.stringify({ ok: false, error: validation.error }, null, 2));
    process.exit(1);
  }

  // Run the browser session
  const result = await runSession(validation.data);

  // Output result as JSON
  console.log(JSON.stringify(result, null, 2));

  // Exit with error code if session failed
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.log(JSON.stringify({
    ok: false,
    error: `Unexpected error: ${err.message}`,
  }, null, 2));
  process.exit(1);
});
