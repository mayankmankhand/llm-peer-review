#!/usr/bin/env node
'use strict';
// jev-client.js - the one way the issue-246 lab asks Jev (TypeSafe's decision model) anything.
// Maintainer-only: lives under scripts/ and is never built into the plugin.
//
// Every test in the lab (the findings replay, the safe-command hook, the wording probe) calls
// decide(), so the data stance is enforced here, in code, rather than promised in prose
// (plans/PLAN-issue-246.md, "One client, and the rules live in its code"). Before any request it
// refuses, sending nothing:
//   - a test name with no daily cap                  -> 'unknown test'
//   - a missing bar file (the bar is written first)   -> 'no bar'
//   - a state whose exact bytes match a secret        -> 'withheld: <pattern>' (issue 222's list)
//   - no OPENROUTER_API_KEY                           -> 'no key'
//   - a test whose calls today reached its cap        -> 'cap'
// Every request carries OpenRouter's two privacy flags (zero data retention, no data collection)
// and asks for a dated Jev build by name, so a silent upgrade cannot change the model under a
// running test. The daily caps bound the lab's spend under its $5 budget whatever the traffic.
//
// decide() never throws: every failure comes back as an error string, so a hook that calls it can
// always exit 0. Key values never appear in any output: an error that echoes the key is scrubbed.
//
// Data home: home() is JEV_LAB_HOME when set (the tests point it at a scratch folder), else the
// main working copy (the folder holding the shared .git, found the way run-checks.js finds it), so
// a run from any worktree, or from a copy under reports/, keys and logs in one place.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const m9 = require(path.join(__dirname, 'm9-shadow-hook.js')); // withholdReason, loadKeys (issue 222)

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = 'typesafe/jev-1.13-20260917';      // the build every verdict is about
const MODEL_114 = 'typesafe/jev-1.14-20261014';  // test 3's side column only
const PROVIDER = Object.freeze({ zdr: true, data_collection: 'deny' });
const TIMEOUT_MS = 5000;
const CAPS = Object.freeze({ safe: 5000, findings: 2000, probe: 200 }); // sent calls per test per UTC day
const KEY_NAME = 'OPENROUTER_API_KEY';

function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

// The main working copy's root: the folder holding the shared .git. Git older than 2.31 prints the
// flag back first, so the path is the last line. Outside a repository, the folder above `dir`.
function mainCopyRoot(dir) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = (r.stdout || '').trim().split('\n');
  const common = lines[lines.length - 1];
  if (r.status !== 0 || !common || path.basename(common) !== '.git') return path.resolve(dir, '..');
  return path.dirname(common);
}

function home() {
  const env = process.env.JEV_LAB_HOME;
  return env && env.trim() ? path.resolve(env.trim()) : mainCopyRoot(__dirname);
}

// The call counter: one byte appended per sent call, so a count is a file size and concurrent
// hooks never need a lock (at worst they overshoot the cap by the few calls racing at the limit).
function utcDay(now) { return (now || new Date()).toISOString().slice(0, 10); }
function callsFile(h, test, now) { return path.join(h, 'reports', 'issue-246', 'calls', test + '-' + utcDay(now) + '.log'); }
function callsToday(h, test, now) {
  try { return fs.statSync(callsFile(h, test, now)).size; } catch (e) { return 0; }
}
function countCall(h, test, now) {
  const file = callsFile(h, test, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, '.');
}

function scrub(text, key) { return key ? String(text).split(key).join('<key>') : String(text); }

// decide(): one request carrying every question (all noul: a probability from 0 to 1 that the
// statement holds). Options: test (a CAPS name), questions ({ id: instructions }), state (the exact
// text sent), bar (a file that must exist), model (default MODEL); for tests: home, fetch, now, cap.
// Returns { sent, model, probs, ms, usage, error }: model is the build the answer names.
async function decide(opts) {
  const o = opts || {};
  const out = { sent: false, model: null, probs: null, ms: 0, usage: null, error: null };
  let key = null;
  try {
    const h = o.home || home();
    const now = o.now ? o.now() : new Date();
    const cap = typeof o.cap === 'number' ? o.cap : CAPS[o.test];
    if (typeof cap !== 'number') { out.error = 'unknown test'; return out; }
    if (!o.bar || !fs.existsSync(o.bar)) { out.error = 'no bar'; return out; }
    const state = String(o.state == null ? '' : o.state);
    const reason = m9.withholdReason(state);
    if (reason) { out.error = 'withheld: ' + reason; return out; }
    key = m9.loadKeys(path.join(h, '.env.local'))[KEY_NAME] || null;
    if (!key) { out.error = 'no key'; return out; }
    if (callsToday(h, o.test, now) >= cap) { out.error = 'cap'; return out; }
    const ids = Object.keys(o.questions || {});
    if (!ids.length) { out.error = 'no questions'; return out; }
    const body = {
      model: o.model || MODEL,
      state,
      provider: PROVIDER,
      questions: Object.fromEntries(ids.map(id => [id, { type: 'noul', instructions: String(o.questions[id]) }])),
    };

    countCall(h, o.test, now);
    out.sent = true;
    const fetchImpl = o.fetch || globalThis.fetch;
    const t0 = Date.now();
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs || TIMEOUT_MS),
      });
    } catch (e) {
      out.ms = Date.now() - t0;
      out.error = scrub(e && e.name === 'TimeoutError' ? 'timeout' : String((e && e.message) || e), key).slice(0, 160);
      return out;
    }
    const text = await res.text();
    out.ms = Date.now() - t0;
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!res.ok) {
      // keep the status and the provider's error code or first words, never the whole body
      const brief = json && json.error ? (json.error.code || json.error.message || '') : text;
      out.error = scrub('http ' + res.status + ': ' + String(brief).replace(/\s+/g, ' '), key).slice(0, 120);
      return out;
    }
    if (!json) { out.error = 'non-json body'; return out; }
    out.model = typeof json.model === 'string' ? json.model : null;
    out.usage = json.usage || null;
    out.probs = Object.fromEntries(ids.map(id => [id, num(json.answers && json.answers[id] && json.answers[id].noul)]));
    if (ids.every(id => out.probs[id] === null)) out.error = 'no probabilities in answer';
  } catch (e) {
    out.error = scrub(String((e && e.message) || e), key).slice(0, 160);
  }
  return out;
}

module.exports = { decide, home, mainCopyRoot, callsFile, callsToday, ENDPOINT, MODEL, MODEL_114, PROVIDER, CAPS, TIMEOUT_MS };
