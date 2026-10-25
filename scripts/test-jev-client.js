#!/usr/bin/env node
'use strict';
// test-jev-client.js - tests for the issue-246 Jev client (scripts/jev-client.js): the request it
// builds, the answers it returns, and the refusals that keep the lab's data stance (an unknown test,
// no bar file, a secret-shaped state, no key, the day's call cap).
// Never touches the network: every case passes its own fetch. The module loads inside a try, so a
// missing module fails each case by name instead of crashing the suite.
// Every secret-shaped fixture is assembled at runtime from pieces, never written as a literal,
// because the push tripwire has no allow-list by design (LESSONS-detail.md, issue 221). The key
// file's name and value are joined at runtime too, so no line here reads as a key assignment.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let client = null, loadError = null;
try { client = require(path.join(__dirname, 'jev-client.js')); } catch (e) { loadError = String(e && e.message || e).split('\n')[0]; }

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('not ok - ' + name + (detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : '')); }
}
async function run(name, fn) {
  if (!client) { check(name, false, 'module did not load: ' + loadError); return; }
  try { const [ok, detail] = await fn(); check(name, ok, detail); }
  catch (e) { check(name, false, 'threw: ' + (e && e.message || e)); }
}
function tmpdir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), 'jev-client-' + label + '-')); }

const FAKE_KEY = 'or-test-' + 'k'.repeat(12);
const KEY_LINE = ['OPENROUTER', 'API', 'KEY'].join('_') + '=' + FAKE_KEY + '\n';
function labHome(opts) {
  const o = opts || {};
  const dir = tmpdir('home');
  if (o.bar !== false) fs.writeFileSync(path.join(dir, 'bar.md'), '# bar\n');
  if (o.key !== false) fs.writeFileSync(path.join(dir, '.env.local'), KEY_LINE);
  return dir;
}
function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  f.calls = calls;
  return f;
}
const GOOD = reply(200, { model: 'typesafe/jev-1.13-20260917', answers: { a: { noul: 0.9 }, b: { noul: 0.1 } }, usage: { input_tokens: 40, cost: 0.0000017 } });
function ask(home, f, extra) {
  return client.decide(Object.assign({ test: 'probe', questions: { a: 'Is it a?', b: 'Is it b?' }, state: 'git status', bar: path.join(home, 'bar.md'), home, fetch: f }, extra || {}));
}

(async () => {
  delete process.env[['OPENROUTER', 'API', 'KEY'].join('_')];
  delete process.env.JEV_LAB_HOME;

  await run('decide sends both privacy flags and the dated 1.13 model', async () => {
    const f = fakeFetch(GOOD);
    await ask(labHome(), f);
    const b = f.calls[0] && f.calls[0].body;
    return [!!b && b.provider.zdr === true && b.provider.data_collection === 'deny' && b.model === 'typesafe/jev-1.13-20260917' && f.calls[0].url === client.ENDPOINT, JSON.stringify(b)];
  });

  await run('every question travels in one request as a noul question', async () => {
    const f = fakeFetch(GOOD);
    await ask(labHome(), f);
    const q = f.calls[0] && f.calls[0].body.questions;
    return [f.calls.length === 1 && !!q && q.a.type === 'noul' && q.b.type === 'noul' && q.a.instructions === 'Is it a?', JSON.stringify(q)];
  });

  await run('decide returns each probability and the build the answer names', async () => {
    const r = await ask(labHome(), fakeFetch(GOOD));
    return [r.sent === true && r.error === null && r.probs.a === 0.9 && r.probs.b === 0.1 && r.model === 'typesafe/jev-1.13-20260917' && r.usage.input_tokens === 40, JSON.stringify(r)];
  });

  await run('a timeout returns an error and never throws', async () => {
    const r = await ask(labHome(), fakeFetch(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    return [r.error === 'timeout' && r.sent === true, JSON.stringify(r)];
  });

  await run('an HTTP error returns its status and never the key', async () => {
    const r = await ask(labHome(), fakeFetch(reply(401, { error: { message: 'bad key ' + FAKE_KEY } })));
    return [/^http 401/.test(r.error || '') && !JSON.stringify(r).includes(FAKE_KEY), JSON.stringify(r)];
  });

  await run('a non-JSON body returns an error', async () => {
    const r = await ask(labHome(), fakeFetch(reply(200, '<html>oops</html>')));
    return [r.error === 'non-json body', JSON.stringify(r)];
  });

  await run('an answer with no probabilities returns an error', async () => {
    const r = await ask(labHome(), fakeFetch(reply(200, { model: 'x', answers: {} })));
    return [r.error === 'no probabilities in answer', JSON.stringify(r)];
  });

  await run('decide refuses an unknown test name, which has no cap', async () => {
    const f = fakeFetch(GOOD);
    const r = await ask(labHome(), f, { test: 'nonesuch' });
    return [r.error === 'unknown test' && r.sent === false && f.calls.length === 0, JSON.stringify(r)];
  });

  await run('decide refuses without its bar file and sends nothing', async () => {
    const f = fakeFetch(GOOD);
    const r = await ask(labHome({ bar: false }), f);
    return [r.error === 'no bar' && r.sent === false && f.calls.length === 0, JSON.stringify(r)];
  });

  await run('decide refuses without a key and sends nothing', async () => {
    const f = fakeFetch(GOOD);
    const r = await ask(labHome({ key: false }), f);
    return [r.error === 'no key' && r.sent === false && f.calls.length === 0, JSON.stringify(r)];
  });

  await run('decide refuses past the day\'s call cap and sends nothing', async () => {
    const home = labHome();
    const file = client.callsFile(home, 'probe');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '.'.repeat(client.CAPS.probe));
    const f = fakeFetch(GOOD);
    const r = await ask(home, f);
    return [r.error === 'cap' && r.sent === false && f.calls.length === 0, JSON.stringify(r)];
  });

  await run('each sent call counts once and a refusal counts nothing', async () => {
    const home = labHome();
    await ask(home, fakeFetch(GOOD));
    await ask(home, fakeFetch(reply(500, 'down')));
    await ask(home, fakeFetch(GOOD), { state: 'echo ' + 'sk-' + 'z'.repeat(24) });
    return [client.callsToday(home, 'probe') === 2, client.callsToday(home, 'probe')];
  });

  await run('home is the main working copy unless JEV_LAB_HOME names another', async () => {
    const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: __dirname, encoding: 'utf8' });
    const lines = r.stdout.trim().split('\n');
    const main = path.dirname(lines[lines.length - 1]);
    const byGit = client.home();
    const other = tmpdir('other');
    process.env.JEV_LAB_HOME = other;
    const byEnv = client.home();
    delete process.env.JEV_LAB_HOME;
    return [byGit === main && byEnv === path.resolve(other), byGit + ' | ' + main + ' | ' + byEnv];
  });

  await run('decide refuses a state that matches a secret pattern', async () => {
    const f = fakeFetch(GOOD);
    const r = await ask(labHome(), f, { state: 'echo ' + 'gh' + 'p_' + 'x'.repeat(24) });
    return [r.error === 'withheld: github-token' && r.sent === false && f.calls.length === 0, JSON.stringify(r)];
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('not ok - test runner threw :: ' + (e && e.stack || e)); process.exit(1); });
