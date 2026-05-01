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
 *     "autoStart": false,
 *     "actions": [
 *       { "type": "goto", "url": "/" },
 *       { "type": "screenshot" },
 *       { "type": "text" },
 *       { "type": "a11y" },
 *       { "type": "responsive" }
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
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  navigationTimeoutMs: 10000,
  actionTimeoutMs: 5000,
  maxTextLength: 50 * 1024, // 50KB
  screenshotDir: '/tmp',
  screenshotPrefix: 'browse-screenshot',
  defaultBaseUrl: 'http://localhost:3000',
  serverPidFile: '/tmp/browse-server.pid',
  defaultPorts: [3000, 3001, 5173, 8080, 8888],
  serverStartTimeoutMs: 30000,
  serverPollIntervalMs: 500,
  portCheckTimeoutMs: 500,
};

// Supported action types
const VALID_ACTIONS = ['goto', 'click', 'fill', 'screenshot', 'text', 'wait', 'a11y', 'responsive'];

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
  TIMEOUT: (action, ms, target) => target
    ? `${action} on "${target}" timed out after ${ms}ms. Element not found, or page not fully loaded.`
    : `${action} timed out after ${ms}ms. Is the page fully loaded?`,
  SERVER_START_TIMEOUT: (ms) => `Dev server did not become ready within ${ms}ms.`,
  NO_DEV_SCRIPT: 'No "dev" or "start" script found in project package.json.',
};

// ── Server auto-detection ──────────────────────────────────────────────────

/**
 * Check if a single port is responding to HTTP requests.
 * Returns true if the port responds within the timeout, false otherwise.
 */
function checkPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port, method: 'HEAD', timeout: timeoutMs },
      () => resolve(true)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Detect a running dev server by checking common ports.
 * Returns the first port that responds, or null if none found.
 */
async function detectServer(ports) {
  const portsToCheck = ports || CONFIG.defaultPorts;
  for (const port of portsToCheck) {
    const alive = await checkPort(port, CONFIG.portCheckTimeoutMs);
    if (alive) return port;
  }
  return null;
}

// ── Server auto-start ──────────────────────────────────────────────────────

// Track the auto-started child process for cleanup
let autoStartedProcess = null;

/**
 * Kill a process by PID, ignoring errors if it is already gone.
 */
function killProcess(pid) {
  try {
    // Kill the entire process group (negative PID) so child servers
    // spawned by npm are also terminated, not just the npm wrapper.
    process.kill(-pid, 'SIGTERM');
  } catch (_) {
    // Process already exited or group kill not supported - try direct kill
    try { process.kill(pid, 'SIGTERM'); } catch (_2) { /* already gone */ }
  }
}

/**
 * Delete stale PID file from a prior run. We do NOT kill the PID -
 * PID reuse on WSL/Linux makes that unsafe (the recorded PID may now
 * belong to an unrelated shell or editor). The port snapshot in
 * startServer will surface a leaked server if one is still bound.
 */
function cleanupOrphanPid() {
  if (!fs.existsSync(CONFIG.serverPidFile)) return;
  try {
    fs.unlinkSync(CONFIG.serverPidFile);
  } catch (_) {
    // If we can't delete, move on
  }
}

/**
 * Stop the auto-started server and clean up PID file.
 */
function stopAutoStartedServer() {
  if (autoStartedProcess) {
    killProcess(autoStartedProcess.pid);
    autoStartedProcess = null;
  }
  try {
    if (fs.existsSync(CONFIG.serverPidFile)) {
      fs.unlinkSync(CONFIG.serverPidFile);
    }
  } catch (_) {
    // Best effort cleanup
  }
}

// Register signal handlers for cleanup
process.on('SIGINT', () => {
  stopAutoStartedServer();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopAutoStartedServer();
  process.exit(143);
});
process.on('exit', () => {
  // On exit, just kill - no async work allowed
  if (autoStartedProcess) {
    killProcess(autoStartedProcess.pid);
  }
});

/**
 * Start a dev server from the project's package.json.
 * Only runs when autoStart is true and no server is already detected.
 *
 * Reads package.json from projectDir, finds a "dev" or "start" script,
 * spawns it, and polls until the port is ready.
 *
 * Returns { port, process } on success, throws on failure.
 */
async function startServer(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const scripts = pkg.scripts || {};

  // Prefer "dev" over "start"
  const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
  if (!scriptName) {
    throw new Error(ERR.NO_DEV_SCRIPT);
  }

  // Clean up any orphan from a previous run
  cleanupOrphanPid();

  // Snapshot which default ports are already serving something BEFORE we spawn,
  // so the port probe below doesn't latch onto an unrelated dev server (e.g.
  // a stale process from another project on 3000) and have us QA the wrong app.
  // Probe in parallel - sequential checks would add up to 2.5s on the cold path.
  const aliveBeforeStates = await Promise.all(
    CONFIG.defaultPorts.map((p) => checkPort(p, CONFIG.portCheckTimeoutMs))
  );
  const portsAliveBeforeSpawn = new Set(
    CONFIG.defaultPorts.filter((_, i) => aliveBeforeStates[i])
  );

  // Spawn the dev server
  const child = spawn('npm', ['run', scriptName], {
    cwd: projectDir,
    stdio: 'ignore',
    detached: true, // New process group so we can kill npm + its children together
  });

  autoStartedProcess = child;
  // unref so the parent's event loop isn't held open by the detached child.
  // We still kill the whole process group on cleanup via process.kill(-pid).
  child.unref();

  // Write PID file
  fs.writeFileSync(CONFIG.serverPidFile, String(child.pid), 'utf-8');

  // Poll until a port that was NOT already alive starts responding. Probe all
  // default ports in parallel each tick. If a port that WAS alive in the
  // snapshot is no longer alive (the unrelated server died between snapshot
  // and now), drop it so our newly-spawned server can claim that port.
  const startTime = Date.now();

  while (Date.now() - startTime < CONFIG.serverStartTimeoutMs) {
    const liveStates = await Promise.all(
      CONFIG.defaultPorts.map((p) => checkPort(p, CONFIG.portCheckTimeoutMs))
    );
    CONFIG.defaultPorts.forEach((port, i) => {
      if (!liveStates[i]) portsAliveBeforeSpawn.delete(port);
    });
    const newPortIdx = CONFIG.defaultPorts.findIndex(
      (port, i) => liveStates[i] && !portsAliveBeforeSpawn.has(port)
    );
    if (newPortIdx !== -1) {
      return { port: CONFIG.defaultPorts[newPortIdx], process: child };
    }
    await new Promise((r) => setTimeout(r, CONFIG.serverPollIntervalMs));
  }

  // Timeout - clean up
  stopAutoStartedServer();
  throw new Error(ERR.SERVER_START_TIMEOUT(CONFIG.serverStartTimeoutMs));
}

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
    // Loud failures for typos in the role: prefix. We intentionally do NOT
    // validate role names against an ARIA whitelist - that would duplicate
    // Playwright's own role list. A typo'd role name (e.g. "buton") surfaces
    // as a TimeoutError with the full target string in the message (see
    // handleClick / handleFill). The two cases we DO catch are shape errors
    // that would otherwise silently dispatch the wrong locator:
    //   "role:" / "role::Submit"        -> empty role
    //   "role:button:" (trailing colon) -> non-empty role, empty name
    if (!role) {
      throw new Error(`Invalid locator "${target}": role: prefix requires a role name (e.g., role:button or role:button:Submit)`);
    }
    if (parts.length > 1 && !name) {
      throw new Error(`Invalid locator "${target}": role: prefix has a trailing colon but no name. Use "role:${role}" or "role:${role}:<name>".`);
    }
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
  // Accept `url` (canonical) or `path` (alias - same semantics, both resolved
  // against baseUrl). When neither is present but other fields are, warn so
  // that typos like "to" or "href" surface instead of silently QAing "/".
  const url = action.url || action.path || '/';
  if (!action.url && !action.path) {
    const otherKeys = Object.keys(action).filter((k) => k !== 'type');
    if (otherKeys.length > 0) {
      console.warn(`[browse.js] goto received unknown fields, defaulting to "/": ${otherKeys.join(', ')}`);
    }
  }
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
      return { type: 'goto', ok: false, url: fullUrl, error: ERR.TIMEOUT('goto', CONFIG.navigationTimeoutMs, fullUrl) };
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
      return { type: 'click', ok: false, target, error: ERR.TIMEOUT('click', CONFIG.actionTimeoutMs, target) };
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
      return { type: 'fill', ok: false, target, error: ERR.TIMEOUT('fill', CONFIG.actionTimeoutMs, target) };
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

/**
 * Run accessibility analysis on the current page using axe-core.
 * Groups violations by impact level and limits node output to avoid huge results.
 */
async function handleA11y(page) {
  let AxeBuilder;
  try {
    AxeBuilder = require('@axe-core/playwright').default;
  } catch (_) {
    return { type: 'a11y', ok: false, error: '@axe-core/playwright not installed' };
  }

  try {
    const results = await new AxeBuilder({ page }).analyze();

    const summary = { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 };
    const violations = results.violations.map((v) => {
      const impact = v.impact || 'minor';
      if (summary[impact] !== undefined) {
        summary[impact]++;
      }
      summary.total++;

      return {
        id: v.id,
        impact,
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 5).map((n) => ({
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      };
    });

    return {
      type: 'a11y',
      ok: true,
      violations,
      summary,
    };
  } catch (err) {
    return { type: 'a11y', ok: false, error: `Accessibility analysis failed: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
  }
}

/**
 * Capture responsive screenshots at mobile, tablet, and desktop viewports.
 * Resizes the viewport, waits for reflow, takes a screenshot, then restores
 * the original viewport size.
 */
async function handleResponsive(page) {
  const viewports = {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 720 },
  };

  // Save original viewport so we can restore it after
  const original = page.viewportSize();
  const timestamp = Date.now();
  const screenshots = {};

  try {
    for (const [name, size] of Object.entries(viewports)) {
      await page.setViewportSize(size);
      await page.waitForTimeout(500); // Wait for reflow
      const filename = `${CONFIG.screenshotPrefix}-${timestamp}-${name}.png`;
      const filepath = path.join(CONFIG.screenshotDir, filename);
      await page.screenshot({ path: filepath, fullPage: true, timeout: CONFIG.actionTimeoutMs });
      screenshots[name] = filepath;
    }

    // Restore original viewport
    if (original) {
      await page.setViewportSize(original);
    }

    return { type: 'responsive', ok: true, screenshots };
  } catch (err) {
    // Restore original viewport even on failure
    if (original) {
      try { await page.setViewportSize(original); } catch (_) { /* best effort */ }
    }
    return { type: 'responsive', ok: false, error: `Responsive screenshots failed: ${err.message.split('\n').slice(0, 3).join(' | ')}` };
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
 * Locate Playwright's browser cache dir. Honors PLAYWRIGHT_BROWSERS_PATH if
 * set, otherwise falls back to the OS default. Used to FS-probe whether any
 * browser is installed at all - more reliable than substring-matching error
 * messages that Playwright may rephrase between releases.
 */
function getPlaywrightBrowsersDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'ms-playwright');
  }
  // Linux / WSL default (also where this script is primarily run)
  return path.join(home, '.cache', 'ms-playwright');
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
    // Two-stage check for "browser not installed". The FS-probe is reliable
    // ONLY when we positively know the cache dir is empty (it exists, we can
    // read it, and there's nothing inside). A missing or unreadable dir is
    // treated as "we don't know" and falls through to the string match - this
    // matters on platforms where our path computation may be incomplete (e.g.
    // native Windows uses %LOCALAPPDATA%\ms-playwright, not ~/.cache).
    let cacheDefinitelyEmpty = false;
    const browsersDir = getPlaywrightBrowsersDir();
    if (fs.existsSync(browsersDir)) {
      try {
        cacheDefinitelyEmpty = fs.readdirSync(browsersDir).length === 0;
      } catch (_) {
        // Unreadable dir - skip; the string match below still has a shot
      }
    }
    if (cacheDefinitelyEmpty) {
      return { ok: false, error: ERR.BROWSER_NOT_FOUND };
    }
    // Fallback: substring match. Catches "specific binary missing from cache"
    // and any platform where the FS-probe couldn't make a determination.
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
    a11y: () => handleA11y(page),
    responsive: () => handleResponsive(page),
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
    "autoStart": false,
    "actions": [
      { "type": "goto", "url": "/" },
      { "type": "click", "target": "text:Login" },
      { "type": "fill", "target": "css:input[name=email]", "value": "user@test.com" },
      { "type": "screenshot" },
      { "type": "text" },
      { "type": "text", "target": "css:.main-content" },
      { "type": "wait", "ms": 2000 },
      { "type": "wait", "selector": "css:.loaded" },
      { "type": "a11y" },
      { "type": "responsive" }
    ]
  }

Action types:
  goto        Navigate to a URL (must be first action)
              Fields: url or path (resolved against baseUrl; url is canonical, path is an alias)
  click       Click an element
              Fields: target (selector with prefix)
  fill        Type text into an input
              Fields: target (selector with prefix), value
  screenshot  Take a full-page screenshot (saved to /tmp)
  text        Extract visible text from page or element
              Fields: target (optional, scoped extraction)
  wait        Wait for time or element
              Fields: ms (milliseconds) or selector
  a11y        Run accessibility analysis using axe-core
              Returns violations grouped by impact level
              Requires @axe-core/playwright (graceful error if missing)
  responsive  Capture screenshots at 3 viewports (mobile, tablet, desktop)
              Mobile: 375x812, Tablet: 768x1024, Desktop: 1280x720
              Screenshots saved to /tmp with viewport suffix

Selector prefixes:
  css:.my-class          CSS selector
  text:Click me          Text content match
  role:button:Submit     ARIA role with name
  .my-class              No prefix = CSS selector

Options:
  autoStart   Set to true in the input JSON to auto-detect or start a dev
              server before running actions. Checks ports 3000, 3001, 5173,
              8080, 8888 for an existing server. If none found, reads the
              project's package.json and runs "npm run dev" (or "npm run
              start"). The server is stopped automatically when done.
              Default: false (opt-in only)

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

  const data = validation.data;
  let serverWasAutoStarted = false;

  // Server auto-start (opt-in only)
  if (data.autoStart === true) {
    try {
      // First check if a server is already running
      const existingPort = await detectServer();
      if (existingPort) {
        data.baseUrl = `http://localhost:${existingPort}`;
      } else {
        // No server found - start one
        const projectDir = data.projectDir || process.cwd();
        const server = await startServer(projectDir);
        data.baseUrl = `http://localhost:${server.port}`;
        serverWasAutoStarted = true;
      }
    } catch (err) {
      console.log(JSON.stringify({
        ok: false,
        error: `Server auto-start failed: ${err.message}`,
      }, null, 2));
      process.exit(1);
    }
  }

  try {
    // Run the browser session
    const result = await runSession(data);

    // Output result as JSON
    console.log(JSON.stringify(result, null, 2));

    // Exit with error code if session failed
    if (!result.ok) {
      process.exit(1);
    }
  } finally {
    // Always clean up the auto-started server
    if (serverWasAutoStarted) {
      stopAutoStartedServer();
    }
  }
}

main().catch((err) => {
  // Clean up server on unexpected errors too
  stopAutoStartedServer();
  console.log(JSON.stringify({
    ok: false,
    error: `Unexpected error: ${err.message}`,
  }, null, 2));
  process.exit(1);
});
