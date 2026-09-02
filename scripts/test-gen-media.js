#!/usr/bin/env node
'use strict';

// test-gen-media.js - exercises .claude/scripts/gen-media.js without a network or a key.
//
// Every branch runs the script as a child process from a SANDBOX copy under the OS temp
// dir, with its own .env.local written beside it, so the script's upward .env.local walk
// stops in the sandbox and can never reach this repo's real file. The child is started
// with `--require scripts/fixtures/fake-fetch.js`, which replaces global fetch inside the
// child and records every request to a JSONL log the assertions read back.
//
// Run: node scripts/test-gen-media.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'gen-media.js');
const PRELOAD = path.join(ROOT, 'scripts', 'fixtures', 'fake-fetch.js');

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log('  ok:   ' + msg); }
function bad(msg) { fail++; console.log('  FAIL: ' + msg); }
function check(cond, msg) { if (cond) ok(msg); else bad(msg); }

// Fake values shaped like the real keys, so a leak into stdout or stderr is countable.
// Assembled at runtime on purpose: the M11 tripwire (.claude/scripts/pre-push-check.js)
// scans every added line for exactly these key shapes and has no allow-list by design,
// so a committed literal in the real shape would block every push that touches this
// block. Each quoted fragment is short enough that no pattern matches the source line,
// while the runtime value still has the shape the leak check needs.
const FAKE = {
  OPENAI_API_KEY: 'sk-' + 'FAKEOPENAI'.padEnd(28, '0'),
  GEMINI_API_KEY: 'AIza' + 'FAKEGEMINI'.padEnd(35, '0'),
  FAL_KEY: ['abcdef01', '2345', '6789', 'abcd', 'ef0123456789'].join('-') + ':' + '0123456789abcdef'.repeat(2),
};

function sandbox(label, keys) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-media-' + label + '-'));
  const copy = path.join(dir, 'gen-media.js');
  fs.copyFileSync(SCRIPT, copy);
  // Written even when empty: the walk stops at the first .env.local it meets.
  const lines = Object.entries(keys).map(([k, v]) => k + '=' + v);
  fs.writeFileSync(path.join(dir, '.env.local'), lines.join('\n') + '\n');
  return { dir, copy, log: path.join(dir, 'requests.jsonl'), out: (name) => path.join(dir, name) };
}

function run(sb, args, mode) {
  const r = spawnSync(process.execPath, ['--require', PRELOAD, sb.copy].concat(args), {
    cwd: sb.dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, FAKE_FETCH_LOG: sb.log, FAKE_FETCH_MODE: mode || 'complete', GEN_MEDIA_POLL_MS: '20' },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  const requests = fs.existsSync(sb.log)
    ? fs.readFileSync(sb.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, requests };
}

// Shared checks for every branch: one JSON object on stdout, no key value anywhere.
function contract(r, label) {
  check(r.json !== null, label + ': stdout is one parseable JSON object');
  check(r.stdout.trim().split('\n').length === 1, label + ': stdout holds exactly one line');
  const everything = r.stdout + r.stderr;
  check(!Object.values(FAKE).some((v) => everything.includes(v)), label + ': no key value in stdout or stderr');
}

console.log('');
console.log('gen-media.js');

// ─── seed ────────────────────────────────────────────────────────────────────
{
  const sb = sandbox('seed', {});
  const r = run(sb, ['--kind', 'seed']);
  contract(r, 'seed');
  check(r.status === 0 && r.json && r.json.ok === true, 'seed: exit 0 and ok');
  check(typeof r.json.seed === 'string' && /^[A-Za-z0-9+/]{32}$/.test(r.json.seed), 'seed: 24 random bytes as base64');
  check(r.requests.length === 0, 'seed: makes no request and needs no key');
}

// ─── image via OpenAI ────────────────────────────────────────────────────────
{
  const sb = sandbox('openai', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY, GEMINI_API_KEY: FAKE.GEMINI_API_KEY });
  const out = sb.out('hero.png');
  const r = run(sb, ['--kind', 'image', '--prompt', 'a crystal on a dark table', '--out', out]);
  contract(r, 'image/openai');
  check(r.status === 0 && r.json.ok === true && r.json.path === out, 'image/openai: exit 0 with the output path');
  check(fs.existsSync(out) && fs.readFileSync(out, 'utf8') === 'PNGDATA-fake', 'image/openai: wrote the decoded image');
  check(r.requests.length === 1 && r.requests[0].url.startsWith('https://api.openai.com/v1/images/generations'), 'image/openai: one request to OpenAI Images');
  check(r.requests[0].authScheme === 'Bearer' && r.json.provider === 'openai', 'image/openai: Bearer auth, provider openai when both keys exist');
  check(r.requests[0].body && r.requests[0].body.model === 'gpt-image-1', 'image/openai: default model id');
}

// ─── image via Gemini ────────────────────────────────────────────────────────
{
  const sb = sandbox('gemini', { GEMINI_API_KEY: FAKE.GEMINI_API_KEY, GEMINI_IMAGE_MODEL: 'gemini-test-image' });
  const out = sb.out('hero.png');
  const r = run(sb, ['--kind', 'image', '--prompt', 'a crystal', '--out', out]);
  contract(r, 'image/gemini');
  check(r.status === 0 && r.json.provider === 'gemini', 'image/gemini: falls back to Gemini when only its key exists');
  check(fs.readFileSync(out, 'utf8') === 'PNGDATA-fake', 'image/gemini: wrote the inlineData part');
  check(r.requests[0].url.includes('/models/gemini-test-image:generateContent') && r.requests[0].authScheme === 'raw', 'image/gemini: model override honored, key sent as a header');
}

// ─── image with no key: the handoff ──────────────────────────────────────────
{
  const sb = sandbox('nokey-image', {});
  const out = sb.out('hero.png');
  const r = run(sb, ['--kind', 'image', '--prompt', 'a crystal on a dark table', '--out', out]);
  contract(r, 'image/handoff');
  check(r.status === 2 && r.json.ok === false, 'image/handoff: exit 2');
  check(JSON.stringify(r.json.missingKeys) === JSON.stringify(['OPENAI_API_KEY', 'GEMINI_API_KEY']), 'image/handoff: names both accepted keys');
  check(typeof r.json.handoffPrompt === 'string' && r.json.handoffPrompt.includes('a crystal on a dark table') && r.json.handoffPrompt.includes(out), 'image/handoff: prompt carries the brief and the file to paste back');
  check(r.json.expectedFile === out && r.requests.length === 0 && !fs.existsSync(out), 'image/handoff: no request, no file, expectedFile set');
}

// ─── video through the fal.ai queue ──────────────────────────────────────────
{
  const sb = sandbox('video', { FAL_KEY: FAKE.FAL_KEY });
  const out = sb.out('loop.mp4');
  const r = run(sb, ['--kind', 'video', '--prompt', 'a crystal splinters and spins', '--out', out]);
  contract(r, 'video');
  check(r.status === 0 && r.json.ok === true && r.json.requestId === 'req_test_123', 'video: exit 0 with the request id');
  check(fs.readFileSync(out, 'utf8') === 'MP4DATA-fake', 'video: downloaded the result clip');
  const urls = r.requests.map((q) => q.method + ' ' + q.url);
  check(urls[0] === 'POST https://queue.fal.run/fal-ai/veo3', 'video: submits to the default model');
  check(urls.filter((u) => u.endsWith('/status')).length === 2, 'video: polled the status URL until COMPLETED');
  check(urls[urls.length - 2].endsWith('/requests/req_test_123') && urls[urls.length - 1] === 'GET https://fake.local/result.mp4', 'video: read the response URL, then downloaded');
  check(r.requests[0].authScheme === 'Key' && r.requests[0].body.prompt === 'a crystal splinters and spins' && !('image_url' in r.requests[0].body), 'video: Key auth, prompt only when no still is given');
}

// ─── video from a still ──────────────────────────────────────────────────────
{
  const sb = sandbox('video-still', { FAL_KEY: FAKE.FAL_KEY, FAL_VIDEO_MODEL: 'fal-ai/test-video' });
  fs.writeFileSync(sb.out('still.png'), 'STILL');
  const r = run(sb, ['--kind', 'video', '--prompt', 'spin', '--image', sb.out('still.png'), '--out', sb.out('loop.mp4')]);
  contract(r, 'video/still');
  check(r.status === 0 && r.requests[0].url === 'https://queue.fal.run/fal-ai/test-video', 'video/still: model override honored');
  check(typeof r.requests[0].body.image_url === 'string' && r.requests[0].body.image_url.startsWith('data:image/png;base64,'), 'video/still: the still travels as a data URI');
}

// ─── matte ───────────────────────────────────────────────────────────────────
{
  const sb = sandbox('matte', { FAL_KEY: FAKE.FAL_KEY });
  fs.writeFileSync(sb.out('loop.mp4'), 'CLIP');
  const r = run(sb, ['--kind', 'matte', '--image', sb.out('loop.mp4'), '--out', sb.out('loop-matte.mp4')]);
  contract(r, 'matte');
  check(r.status === 0 && r.requests[0].url === 'https://queue.fal.run/fal-ai/ben/v2/video', 'matte: submits to the default matting model');
  check(r.requests[0].body.video_url === 'data:video/mp4;base64,' + Buffer.from('CLIP').toString('base64'), 'matte: sends the input clip as a data URI');
  check(fs.existsSync(sb.out('loop-matte.mp4')), 'matte: wrote the output clip');
}

// ─── queue never completes: the timeout branch ───────────────────────────────
{
  const sb = sandbox('timeout', { FAL_KEY: FAKE.FAL_KEY });
  const r = run(sb, ['--kind', 'video', '--prompt', 'spin', '--out', sb.out('loop.mp4'), '--timeout', '1'], 'never');
  contract(r, 'timeout');
  check(r.status === 3 && r.json.ok === false && r.json.timedOut === true, 'timeout: exit 3');
  check(r.json.requestId === 'req_test_123' && typeof r.json.statusUrl === 'string', 'timeout: carries the request id to resume with');
  check(!fs.existsSync(sb.out('loop.mp4')), 'timeout: wrote no file');
}

// ─── video with no key ───────────────────────────────────────────────────────
{
  const sb = sandbox('nokey-video', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  const r = run(sb, ['--kind', 'video', '--prompt', 'spin', '--out', sb.out('loop.mp4')]);
  contract(r, 'video/handoff');
  check(r.status === 2 && JSON.stringify(r.json.missingKeys) === JSON.stringify(['FAL_KEY']), 'video/handoff: exit 2 naming FAL_KEY even when an image key exists');
}

// ─── refuses to overwrite ────────────────────────────────────────────────────
{
  const sb = sandbox('overwrite', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb.out('hero.png'), 'KEEP ME');
  const r = run(sb, ['--kind', 'image', '--prompt', 'x', '--out', sb.out('hero.png')]);
  contract(r, 'overwrite');
  check(r.status === 1 && /overwrite/.test(r.json.error) && r.requests.length === 0, 'overwrite: exit 1 before any request');
  check(fs.readFileSync(sb.out('hero.png'), 'utf8') === 'KEEP ME', 'overwrite: existing file untouched');
}

// ─── bad flags ───────────────────────────────────────────────────────────────
{
  const sb = sandbox('flags', {});
  const r = run(sb, ['--kind', 'poster']);
  contract(r, 'flags');
  check(r.status === 1 && /--kind must be one of/.test(r.json.error), 'flags: unknown kind is exit 1 with a clear error');
}

console.log('');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
