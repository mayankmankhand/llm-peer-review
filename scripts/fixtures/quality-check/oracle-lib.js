'use strict';
//
// oracle-lib.js - what the fix oracles of every fixture share
// (scripts/quality-check.js --role fix, harness research plan Step 11; split out
// of the first fixture's lib.js when a second fixture arrived, #278).
//
// Why: a fix verifier judges whether the defect a finding named is gone, and a
// fix that deleted the feature along with the defect passed it 3 of 3 times
// (reports/harness-papers-2026-10-12/b1-fix-verifier.md). So each planted bug
// that can be checked by running something has two oracles: "gone" (the bug's
// symptom no longer reproduces) and "works" (the feature the bug sat in still
// does its job). A real fix passes both; a deletion passes gone and fails works.
//
// The oracles live in each fixture's oracles/ folder, outside the scratch
// project, and are copied to a temp folder only at judge time, after the session
// has ended, so the fixer never sees them; this file and loopback.js are copied
// in beside them. Each one runs as
//   node <bug-id>.<gone|works>.js <tree> <port>
// on its own throwaway copy of the project tree (it may write there: seed rows,
// backups, a CSV), and starts the tree's server on <port> when it needs one,
// bound to 127.0.0.1 by loopback.js. It prints one line,
//   <PASS|FAIL|UNJUDGED> <bug-id> <gone|works>: <why>
// and exits 0 PASS, 1 FAIL, 2 UNJUDGED (it could not judge: the port was taken,
// no browser, a bad call, an error in the oracle itself).
//
// The gone rule: a gone oracle FAILs only when the planted symptom demonstrably
// reproduces. When the code that held it no longer runs at all (deleted, or the
// server will not start), the symptom cannot reproduce and gone PASSes, saying
// so. That is the literal "the defect is gone" a fix verifier reads, and the
// works oracle is the half that catches the deletion.
//
// A fixture's own oracles/lib.js holds its seed data and re-exports this file.

const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Beside this file, in the repository and in the judge's temp copy alike.
const LOOPBACK = path.join(__dirname, 'loopback.js');

class Unjudged extends Error {}
const PASS = why => ({ verdict: 'PASS', why });
const FAIL = why => ({ verdict: 'FAIL', why });
const EXIT = { PASS: 0, FAIL: 1, UNJUDGED: 2 };
const ORACLE_LIMIT_MS = 75 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const live = new Set();
async function cleanupAll() {
  for (const stop of [...live]) { try { await stop(); } catch (e) { /* best effort */ } }
  live.clear();
}

// Runs `judge({ tree, port })`, which resolves PASS(...) or FAIL(...) or throws
// Unjudged, prints the one line and exits with its code.
function oracle(id, kind, judge) {
  const [tree, portText] = process.argv.slice(2);
  const port = Number(portText);
  let said = false;
  const say = (verdict, why) => {
    if (said) return;
    said = true;
    process.stdout.write(verdict + ' ' + id + ' ' + kind + ': ' + String(why).replace(/\s+/g, ' ').trim() + '\n');
    process.exitCode = EXIT[verdict];
  };
  if (!tree || !fs.existsSync(tree) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    say('UNJUDGED', 'usage: node ' + path.basename(process.argv[1]) + ' <tree> <port>');
    process.exit(2);
  }
  const timer = setTimeout(() => {
    say('UNJUDGED', 'the oracle ran past ' + ORACLE_LIMIT_MS / 1000 + ' s');
    cleanupAll().finally(() => process.exit(2));
  }, ORACLE_LIMIT_MS);
  Promise.resolve()
    .then(() => judge({ tree: path.resolve(tree), port }))
    .then(r => say(r.verdict, r.why))
    .catch(e => say('UNJUDGED', e instanceof Unjudged ? e.message : 'oracle error: ' + (e && e.message || e)))
    .finally(() => cleanupAll().finally(() => { clearTimeout(timer); process.exit(process.exitCode); }));
}

function lastLine(text) {
  return String(text || '').trim().split('\n').filter(l => l.trim()).pop() || '';
}

// ---------------------------------------------------------------------------
// The tree's server
// ---------------------------------------------------------------------------

function portAnswers(port) {
  return new Promise(resolve => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

// Starts the tree's server.js on `port`, loopback only. Resolves { up: true } once
// it answers, or { up: false, why } when the tree's server will not start (that is
// the tree's doing). Throws Unjudged when something else holds the port. The
// server, like the npm scripts below, gets this oracle's environment, which the
// judge has already stripped of key-like names (quality-check.js, childEnv).
async function startServer(tree, port) {
  for (let i = 0; i < 25 && await portAnswers(port); i++) await sleep(200);
  if (await portAnswers(port)) throw new Unjudged('port ' + port + ' is in use by another process');
  if (!fs.existsSync(path.join(tree, 'server.js'))) return { up: false, why: 'the tree has no server.js' };
  const child = spawn(process.execPath, ['--require', LOOPBACK, 'server.js'], { cwd: tree, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  let exited = null;
  child.stdout.on('data', () => {});
  child.stderr.on('data', d => { err = (err + d).slice(-4000); });
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  const stop = async () => {
    if (exited) return;
    try { child.kill('SIGKILL'); } catch (e) { return; }
    for (let i = 0; i < 20 && !exited; i++) await sleep(50);
  };
  live.add(stop);
  for (let i = 0; i < 50 && !exited; i++) {
    if (await portAnswers(port)) return { up: true };
    await sleep(200);
  }
  await stop();
  if (/EADDRINUSE/.test(err)) throw new Unjudged('port ' + port + ' is in use (EADDRINUSE)');
  const tail = lastLine(err);
  return { up: false, why: exited ? 'server.js exited (' + (exited.code !== null ? 'code ' + exited.code : exited.signal) + ')' + (tail ? ': ' + tail.slice(0, 200) : '') : 'server.js did not answer on port ' + port + ' within 10 s' };
}

// One HTTP request to the tree's server; never rejects. status 0 means no answer.
function request(port, method, urlPath, body) {
  return new Promise(resolve => {
    const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {};
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false, timeout: 5000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', e => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0) }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer within 5 s')));
    req.on('error', e => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0) }));
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function requestJson(port, method, urlPath, body) {
  const r = await request(port, method, urlPath, body);
  let json;
  try { json = JSON.parse(r.body.toString('utf8')); } catch (e) { json = undefined; }
  return { ...r, json };
}

const ids = list => (Array.isArray(list) ? list.map(n => (n && n.id) || '?') : null);

// ---------------------------------------------------------------------------
// npm scripts, the way the README tells a user to run them
// ---------------------------------------------------------------------------

function packageJson(tree) {
  try { return JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf8')); } catch (e) { return null; }
}

function npmRun(tree, script, args) {
  const r = spawnSync('npm', ['run', '--silent', script].concat(args && args.length ? ['--'].concat(args) : []), {
    cwd: tree, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' },
  });
  if (r.error && r.error.code === 'ENOENT') throw new Unjudged('npm is not on PATH');
  return { status: r.status === null ? 124 : r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? '\n' + r.error.message : '') };
}

// ---------------------------------------------------------------------------
// A browser, for the bugs that only show in the page
// ---------------------------------------------------------------------------

// For an oracle whose control sits behind another planted bug: a planted script
// crash can stop the page before it wires the control under test, so an element
// lookup that finds nothing returns a detached stand-in element instead, and one
// planted bug cannot hide another (withPage's stubMissing option).
function stubMissingElements() {
  const real = Document.prototype.getElementById;
  Document.prototype.getElementById = function getElementById(id) {
    return real.call(this, id) || document.createElement('input');
  };
}

// Opens the app's page and runs fn(page, errors); errors collects uncaught page
// errors. Resolves fn's result, or { down: why } when the page would not load.
async function withPage(port, fn, opts) {
  let pw;
  try { pw = require(process.env.QC_PLAYWRIGHT_CORE || 'playwright-core'); } catch (e) { throw new Unjudged('no playwright-core to drive a browser (QC_PLAYWRIGHT_CORE is unset or wrong)'); }
  let browser;
  try { browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch (e) { throw new Unjudged('the browser did not launch: ' + lastLine(String(e && e.message || e).split('\n')[0])); }
  const close = () => browser.close().catch(() => {});
  live.add(close);
  try {
    const context = await browser.newContext();
    if (opts && opts.stubMissing) await context.addInitScript(stubMissingElements);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    let res;
    try { res = await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load', timeout: 10000 }); }
    catch (e) { return { down: 'the page did not load: ' + String(e.message).split('\n')[0] }; }
    if (!res || res.status() !== 200) return { down: 'the page answered ' + (res ? res.status() : 'nothing') };
    await sleep(700);
    return await fn(page, errors);
  } finally {
    await close();
    live.delete(close);
  }
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
}

// Polls `test` (async, truthy when done) every 150 ms for up to `ms`.
async function waitFor(test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() >= end) return v;
    await sleep(150);
  }
}

module.exports = {
  Unjudged, PASS, FAIL, oracle, lastLine, sleep,
  startServer, request, requestJson, ids, packageJson, npmRun, withPage, bodyText, waitFor,
};
