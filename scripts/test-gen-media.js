#!/usr/bin/env node
'use strict';

// test-gen-media.js - exercises .claude/scripts/gen-media.js without a network or a key.
//
// Every branch runs the script as a child process from a SANDBOX copy under the OS temp
// dir (next to a copy of the env-local.js module it requires), with the sandbox as its
// working directory and its own .env.local written there, so the project .env.local
// lookup stops in the sandbox and can never reach this repo's real file. HOME is the
// sandbox too, so the machine file lookup (~/.claude/plugins/.env.local, issue #177)
// can never reach the real one either. The child is started
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
  fs.copyFileSync(path.join(path.dirname(SCRIPT), 'env-local.js'), path.join(dir, 'env-local.js'));
  // Written even when empty: the project lookup reads only the first .env.local it meets.
  const lines = Object.entries(keys).map(([k, v]) => k + '=' + v);
  fs.writeFileSync(path.join(dir, '.env.local'), lines.join('\n') + '\n');
  return { dir, copy, log: path.join(dir, 'requests.jsonl'), out: (name) => path.join(dir, name) };
}

function run(sb, args, mode) {
  const r = spawnSync(process.execPath, ['--require', PRELOAD, sb.copy].concat(args), {
    cwd: sb.dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: sb.dir, USERPROFILE: sb.dir, FAKE_FETCH_LOG: sb.log, FAKE_FETCH_MODE: mode || 'complete', GEN_MEDIA_POLL_MS: '20' },
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

// ─── resume an earlier job with --request-id ─────────────────────────────────
{
  const sb = sandbox('resume', { FAL_KEY: FAKE.FAL_KEY });
  const out = sb.out('loop.mp4');
  const r = run(sb, ['--kind', 'video', '--request-id', 'req_test_123', '--out', out]);
  contract(r, 'resume');
  check(r.status === 0 && r.json.ok === true && r.json.requestId === 'req_test_123', 'resume: exit 0 collecting the earlier job');
  check(!r.requests.some((q) => q.method === 'POST'), 'resume: submits nothing, so nothing is paid for twice');
  check(r.requests[0].url.endsWith('/requests/req_test_123/status'), 'resume: goes straight to the status URL');
  check(fs.readFileSync(out, 'utf8') === 'MP4DATA-fake', 'resume: downloaded the result clip');
  const m = run(sandbox('resume-matte', { FAL_KEY: FAKE.FAL_KEY }), ['--kind', 'matte', '--request-id', 'req_test_123', '--out', sb.out('m.mp4')]);
  check(m.status === 0 && m.json.provider === 'fal', 'resume: matte collects without --image');
  const bad = run(sandbox('resume-image', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY }), ['--kind', 'image', '--request-id', 'x', '--prompt', 'y', '--out', sb.out('i.png')]);
  check(bad.status === 1 && /request-id/.test(bad.json.error), 'resume: refused for image');
}

// ─── a flaky status poll is retried, not fatal ───────────────────────────────
{
  const sb = sandbox('flaky', { FAL_KEY: FAKE.FAL_KEY });
  const out = sb.out('loop.mp4');
  const r = run(sb, ['--kind', 'video', '--prompt', 'spin', '--out', out], 'flaky');
  contract(r, 'flaky');
  check(r.status === 0 && fs.existsSync(out), 'flaky: two 502 polls do not abandon the job');
  check(r.requests.filter((q) => q.url.endsWith('/status')).length >= 3, 'flaky: kept polling through the two bad responses');
}

// ─── the output directory is created before any provider is called ──────────
{
  const sb = sandbox('mkdir', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  const out = sb.out(path.join('public', 'media', 'hero.png'));
  const r = run(sb, ['--kind', 'image', '--prompt', 'x', '--out', out]);
  contract(r, 'mkdir');
  check(r.status === 0 && fs.existsSync(out), 'mkdir: a missing asset folder is created, the image lands');
}

// ─── a dangling symlink at --out is refused, its target never written ────────
{
  const sb = sandbox('symlink', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  const target = sb.out(path.join('nowhere', 'target.png'));
  const link = sb.out('link.png');
  fs.symlinkSync(target, link);
  const r = run(sb, ['--kind', 'image', '--prompt', 'x', '--out', link]);
  contract(r, 'symlink');
  check(r.status === 1 && /overwrite/.test(r.json.error), 'symlink: exit 1 with the overwrite refusal');
  check(!fs.existsSync(target), 'symlink: nothing was written through the link');
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

// ─── --prompt-file: the prompt arrives byte for byte ─────────────────────────
{
  // Everything a shell would expand or mangle: backticks, $VAR, ${VAR}, $(cmd), both
  // quote kinds, a backslash, a literal \n, an inner newline, and a non-ASCII letter.
  const tricky = 'A `crystal` on "dark" glass, it\'s $HOME and ${PATH} and $(whoami); \\ and \\n stay\nline two: 50% *off* café';
  const sb = sandbox('prompt-file', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb.out('prompt.txt'), tricky + '\n');
  const out = sb.out('hero.png');
  const r = run(sb, ['--kind', 'image', '--prompt-file', sb.out('prompt.txt'), '--out', out]);
  contract(r, 'prompt-file');
  check(r.status === 0 && r.json.ok === true && fs.existsSync(out), 'prompt-file: exit 0 and the image lands');
  check(r.requests.length === 1 && r.requests[0].body && r.requests[0].body.prompt === tricky, 'prompt-file: backticks, $VAR, and both quote kinds arrive byte-identical, the trailing newline dropped');

  const vsb = sandbox('prompt-file-video', { FAL_KEY: FAKE.FAL_KEY });
  fs.writeFileSync(vsb.out('prompt.txt'), tricky + '\n');
  const v = run(vsb, ['--kind', 'video', '--prompt-file', vsb.out('prompt.txt'), '--out', vsb.out('loop.mp4')]);
  contract(v, 'prompt-file/video');
  check(v.status === 0 && v.requests[0].method === 'POST' && v.requests[0].body.prompt === tricky, 'prompt-file/video: the same bytes reach the fal.ai submit');
}

// ─── --prompt-file: only one trailing line ending is dropped ─────────────────
{
  const sb = sandbox('prompt-file-crlf', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb.out('prompt.txt'), 'first line\r\nsecond line\r\n');
  const r = run(sb, ['--kind', 'image', '--prompt-file', sb.out('prompt.txt'), '--out', sb.out('hero.png')]);
  check(r.status === 0 && r.requests[0].body.prompt === 'first line\r\nsecond line', 'prompt-file/eol: a CRLF file loses only its final line ending');
  const sb2 = sandbox('prompt-file-two', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb2.out('prompt.txt'), 'ends with a blank line\n\n');
  const r2 = run(sb2, ['--kind', 'image', '--prompt-file', sb2.out('prompt.txt'), '--out', sb2.out('hero.png')]);
  check(r2.status === 0 && r2.requests[0].body.prompt === 'ends with a blank line\n', 'prompt-file/eol: of two trailing newlines, one is kept');
}

// ─── --prompt-file: a leading byte order mark is dropped ─────────────────────
{
  // Windows PowerShell 5.1 `Out-File -Encoding utf8` starts the file with EF BB BF. Only
  // that one leading mark goes: a second mark right after it and one in the middle of
  // the text are prompt bytes like any other, and so is everything else.
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  const text = 'a crystal \uFEFF on "dark" glass, café\r\nline two `ticked` $HOME';
  const sb = sandbox('prompt-file-bom', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb.out('prompt.txt'), Buffer.concat([BOM, Buffer.from(text + '\r\n', 'utf8')]));
  const r = run(sb, ['--kind', 'image', '--prompt-file', sb.out('prompt.txt'), '--out', sb.out('hero.png')]);
  contract(r, 'prompt-file/bom');
  const sent = r.requests[0] && r.requests[0].body && r.requests[0].body.prompt;
  check(r.status === 0 && typeof sent === 'string' && sent.charCodeAt(0) !== 0xfeff && sent === text, 'prompt-file/bom: a file starting with a BOM arrives without it, the rest identical');
  check(typeof sent === 'string' && Buffer.from(sent, 'utf8').equals(Buffer.from(text, 'utf8')), 'prompt-file/bom: the sent bytes equal the file bytes minus the BOM and the final line ending (a mid-text U+FEFF kept)');

  const dsb = sandbox('prompt-file-bom-twice', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(dsb.out('prompt.txt'), Buffer.concat([BOM, BOM, Buffer.from('two marks\n', 'utf8')]));
  const d = run(dsb, ['--kind', 'image', '--prompt-file', dsb.out('prompt.txt'), '--out', dsb.out('hero.png')]);
  check(d.status === 0 && d.requests[0].body.prompt === '\uFEFFtwo marks', 'prompt-file/bom: only one leading BOM is stripped, a second one stays');

  const esb = sandbox('prompt-file-bom-only', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(esb.out('prompt.txt'), Buffer.concat([BOM, Buffer.from('\n')]));
  const e = run(esb, ['--kind', 'image', '--prompt-file', esb.out('prompt.txt'), '--out', esb.out('hero.png')]);
  check(e.status === 1 && /--prompt-file is empty/.test(e.json && e.json.error) && e.requests.length === 0, 'prompt-file/bom: a file holding only a BOM and a newline is empty, exit 1 before any request');
}

// ─── --prompt-file with no key: the handoff carries the file's prompt ────────
{
  const sb = sandbox('prompt-file-handoff', {});
  const text = 'a "quoted" `ticked` $PROMPT';
  fs.writeFileSync(sb.out('prompt.txt'), text + '\n');
  const r = run(sb, ['--kind', 'image', '--prompt-file', sb.out('prompt.txt'), '--out', sb.out('hero.png')]);
  contract(r, 'prompt-file/handoff');
  check(r.status === 2 && r.json.handoffPrompt.includes('Prompt: ' + text + '\n\nPNG'), 'prompt-file/handoff: the file prompt reaches the handoff unchanged');
  check(r.stderr.includes('the environment') && r.stderr.includes("the project's .env.local") && r.stderr.includes('~/.claude/plugins/.env.local'), 'prompt-file/handoff: the missing-key diagnostic names all three places a key can live');
}

// ─── --prompt and --prompt-file: exactly one ─────────────────────────────────
{
  const sb = sandbox('prompt-both', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY });
  fs.writeFileSync(sb.out('prompt.txt'), 'from the file\n');
  const both = run(sb, ['--kind', 'image', '--prompt', 'inline', '--prompt-file', sb.out('prompt.txt'), '--out', sb.out('hero.png')]);
  contract(both, 'prompt-both');
  check(both.status === 1 && /--prompt and --prompt-file/.test(both.json.error) && /not both/.test(both.json.error), 'prompt-both: both flags is exit 1 with a clear error');
  check(both.requests.length === 0 && !fs.existsSync(sb.out('hero.png')), 'prompt-both: no request, no file');

  const nsb = sandbox('prompt-neither', { FAL_KEY: FAKE.FAL_KEY });
  const neither = run(nsb, ['--kind', 'video', '--out', nsb.out('loop.mp4')]);
  contract(neither, 'prompt-neither');
  check(neither.status === 1 && /--prompt or --prompt-file is required/.test(neither.json.error), 'prompt-neither: neither flag is exit 1 naming both');
  check(neither.requests.length === 0, 'prompt-neither: no request');

  const missing = run(sandbox('prompt-missing', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY }), ['--kind', 'image', '--prompt-file', sb.out('no-such-prompt.txt'), '--out', sb.out('m.png')]);
  check(missing.status === 1 && /cannot read --prompt-file/.test(missing.json.error) && missing.requests.length === 0, 'prompt-file: an unreadable file is exit 1 before any request');
  fs.writeFileSync(sb.out('empty.txt'), '\n');
  const empty = run(sandbox('prompt-empty', { OPENAI_API_KEY: FAKE.OPENAI_API_KEY }), ['--kind', 'image', '--prompt-file', sb.out('empty.txt'), '--out', sb.out('e.png')]);
  check(empty.status === 1 && /--prompt-file is empty/.test(empty.json.error) && empty.requests.length === 0, 'prompt-file: an empty file is exit 1 before any request');

  const rsb = sandbox('prompt-file-resume', { FAL_KEY: FAKE.FAL_KEY });
  const resume = run(rsb, ['--kind', 'video', '--request-id', 'req_test_123', '--prompt-file', rsb.out('gone.txt'), '--out', rsb.out('loop.mp4')]);
  contract(resume, 'prompt-file/resume');
  check(resume.status === 0 && resume.json.requestId === 'req_test_123' && !resume.requests.some((q) => q.method === 'POST'), 'prompt-file/resume: a rerun whose prompt file is gone still collects the job');
}

// ─── the fixture reads headers the way a caller sends them ──────────────────
{
  // gen-media.js passes plain objects, but the OpenAI SDK passes a Headers instance;
  // the fixture must see the bearer token either way, and never log the token.
  const sb = sandbox('fixture-headers', {});
  const probe = path.join(sb.dir, 'probe.js');
  fs.writeFileSync(probe, [
    "const token = 'Bearer ' + 'sk-' + 'test-x';",
    "(async () => {",
    "  await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: new Headers({ Authorization: token }), body: '{}' });",
    "  await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: token }, body: '{}' });",
    "  await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });",
    "})();",
  ].join('\n') + '\n');
  const r = spawnSync(process.execPath, ['--require', PRELOAD, probe], { cwd: sb.dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: sb.dir, USERPROFILE: sb.dir, FAKE_FETCH_LOG: sb.log } });
  const logText = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8') : '';
  const reqs = logText.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  check(r.status === 0 && reqs.length === 3, 'fixture/headers: the probe made three requests');
  check(reqs[0] && reqs[0].hasAuth === true && reqs[0].authScheme === 'Bearer', 'fixture/headers: a Headers instance carrying a bearer token logs hasAuth true');
  check(reqs[1] && reqs[1].hasAuth === true && reqs[1].authScheme === 'Bearer', 'fixture/headers: a plain object with a lowercase authorization key logs hasAuth true');
  check(reqs[2] && reqs[2].hasAuth === false && reqs[2].authScheme === null, 'fixture/headers: a request without auth logs hasAuth false');
  check(!logText.includes('sk-' + 'test-x'), 'fixture/headers: the token itself is never logged');
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
