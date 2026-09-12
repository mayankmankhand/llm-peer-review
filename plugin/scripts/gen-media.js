#!/usr/bin/env node

// gen-media.js - the design workflow's media helper (issue #160).
//
// Four kinds, one contract:
//   --kind seed    prints a random string for Technique 1 (seed strings). Reads no key.
//   --kind image   text-to-image through OpenAI Images (OPENAI_API_KEY) or, when that
//                  key is absent, Gemini's image model (GEMINI_API_KEY).
//   --kind video   text-to-video (optionally from a still via --image) through the
//                  fal.ai queue API (FAL_KEY).
//   --kind matte   background removal on a video (--image is the input clip) through
//                  the fal.ai queue API (FAL_KEY). Technique 5's second step.
//   --request-id   with video or matte: collect a job an earlier run submitted (exit 3)
//                  instead of submitting a new one. --prompt and --image are not needed.
//
// Contract (mirrors session-init.js):
//   - stdout = exactly one JSON object. Nothing else is ever written there, so the
//     caller (Claude, through the Bash tool) can JSON.parse it.
//   - stderr = human-readable diagnostics only (LESSONS: "Diagnostic output to
//     stderr when stdout is captured by another LLM").
//   - Key VALUES never appear in any output. Only key NAMES do, in missingKeys.
//   - Exit 0: { ok: true, path } or { ok: true, seed }.
//     Exit 2: { ok: false, missingKeys: [...], handoffPrompt, expectedFile } - the
//             key the kind needs is not set, so the user can run the prompt in
//             another tool and paste the file back at expectedFile.
//     Exit 3: { ok: false, timedOut, requestId, statusUrl, error? } - the fal.ai job was
//             submitted but not collected: the queue did not finish inside --timeout
//             seconds (timedOut: true), or a poll, result read, or download failed
//             after submission. The job is still on fal.ai; rerun the same --kind and
//             --out with --request-id <requestId> to collect it without paying twice.
//     Exit 1: { ok: false, error } - anything else (bad flags, API error, Node too old).
//   - Zero dependencies. Node 18+ for the global fetch.
//
// Keys come from .env.local, found by the same upward walk ask-gpt.js uses, and a
// real environment variable always wins. Claude never reads .env.local itself; this
// script does, which is why it is the only place the design workflow touches a key.
//
// Model ids change often on every provider. Every default below can be overridden
// from .env.local (see .env.local.example and API-KEYS.md). When a provider answers
// 404 or 422, the id has moved: set the matching *_MODEL variable to a current one.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Output helpers (the stdout contract) ────────────────────────────────────

function diag(msg) {
  process.stderr.write(`[gen-media] ${msg}\n`);
}

// The ONLY writer to stdout. Every exit path ends here, once.
function finish(obj, code) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

function fail(error) {
  finish({ ok: false, error }, 1);
}

// Node floor: global fetch arrived in Node 18. This is the one toolkit script a user can
// run without an npm install, so say so plainly instead of dying on a ReferenceError.
if (typeof fetch !== 'function') {
  diag(`gen-media.js needs Node 18 or newer (global fetch). Found ${process.version}.`);
  finish({ ok: false, error: `Node 18 or newer required, found ${process.version}` }, 1);
}

// ─── .env.local (same walk and parse rules as ask-gpt.js) ────────────────────

function findEnvLocal(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, '.env.local');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(startDir, '..', '..', '.env.local');
}

function loadEnvLocal() {
  const envPath = findEnvLocal(__dirname);
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  });
}

// ─── Flags ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return { error: `Unexpected argument: ${a}` };
    const name = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `Missing value for --${name}` };
    args[name] = value;
    i++;
  }
  return args;
}

const KINDS = ['seed', 'image', 'video', 'matte'];

const DEFAULTS = {
  OPENAI_IMAGE_MODEL: 'gpt-image-1',
  GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
  FAL_VIDEO_MODEL: 'fal-ai/veo3',
  FAL_MATTE_MODEL: 'fal-ai/ben/v2/video',
};

function envOr(name) {
  const v = (process.env[name] || '').trim();
  return v || DEFAULTS[name];
}

// Poll interval for the fal.ai queue. An env knob so the test suite can run the
// timeout branch in milliseconds instead of seconds; nobody else needs to set it.
const POLL_MS = parseInt(process.env.GEN_MEDIA_POLL_MS, 10) || 3000;

// ─── Small utilities ─────────────────────────────────────────────────────────

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

// fal.ai accepts data URIs wherever it accepts a file URL, which spares us its
// storage-upload API and keeps the script dependency-free.
function fileToDataUri(file) {
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}


// Depth-first search for the first URL-shaped string under a media-looking key. fal
// models disagree on the field name (video.url, video_url, images[0].url, output.url).
function findMediaUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /url|video|image|output/i.test(k)) return v;
  }
  for (const v of Object.values(obj)) {
    const hit = findMediaUrl(v);
    if (hit) return hit;
  }
  return null;
}

// ─── Deadline (the --timeout bound) ──────────────────────────────────────────

class Deadline {
  constructor(seconds) {
    this.endsAt = Date.now() + seconds * 1000;
  }
  remainingMs() {
    return Math.max(0, this.endsAt - Date.now());
  }
  expired() {
    return this.remainingMs() === 0;
  }
  // Every fetch carries an AbortSignal for whatever time is left, so a hung
  // request cannot outlive the bound the caller asked for.
  signal() {
    return AbortSignal.timeout(Math.max(1, this.remainingMs()));
  }
}

async function readJsonResponse(res, what) {
  const text = await res.text();
  if (!res.ok) {
    // Status and a short body excerpt only. The body is the provider's error
    // message; our key is in the request headers, which are never echoed.
    throw new Error(`${what} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

async function download(url, out, deadline) {
  const res = await fetch(url, { signal: deadline.signal() });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()), { flag: 'wx' });
}

// ─── Handoff (exit 2) ────────────────────────────────────────────────────────

const HANDOFF = {
  image: (a) => `Generate one image for a product design.\n\nPrompt: ${a.prompt}\n\nPNG, 1024 by 1024 or larger, no text overlay unless the prompt asks for it. Save the file as: ${a.out}`,
  video: (a) => `Generate a short looping video clip for a product design.\n\nPrompt: ${a.prompt}\n${a.image ? `Start from the still image at: ${a.image}\n` : ''}\nAbout 5 seconds, seamless loop, MP4. Save the file as: ${a.out}`,
  matte: (a) => `Remove the background from this video with a video matting model, keeping the subject and its motion intact.\n\nInput clip: ${a.image}\n\nOutput a clip with a transparent (alpha) background where the format allows it, otherwise a solid green background for chroma keying. Save the file as: ${a.out}`,
};

function handoff(kind, args, missingKeys) {
  diag(`no key for ${kind} (${missingKeys.join(' or ')}); handing the prompt back`);
  finish({ ok: false, missingKeys, handoffPrompt: HANDOFF[kind](args), expectedFile: args.out }, 2);
}

// ─── Providers ───────────────────────────────────────────────────────────────

async function openaiImage(args, deadline) {
  const model = envOr('OPENAI_IMAGE_MODEL');
  diag(`OpenAI Images, model ${model}`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
    body: JSON.stringify({ model, prompt: args.prompt, n: 1, size: '1024x1024' }),
    signal: deadline.signal(),
  });
  const json = await readJsonResponse(res, 'OpenAI Images');
  const item = json.data && json.data[0];
  if (!item) throw new Error('OpenAI Images returned no image');
  if (item.b64_json) {
    fs.writeFileSync(args.out, Buffer.from(item.b64_json, 'base64'), { flag: 'wx' });
  } else if (item.url) {
    await download(item.url, args.out, deadline);
  } else {
    throw new Error('OpenAI Images returned neither b64_json nor url');
  }
  return { provider: 'openai', model };
}

async function geminiImage(args, deadline) {
  const model = envOr('GEMINI_IMAGE_MODEL');
  diag(`Gemini image model ${model}`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim() },
    body: JSON.stringify({
      contents: [{ parts: [{ text: args.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
    signal: deadline.signal(),
  });
  const json = await readJsonResponse(res, 'Gemini');
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  const part = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw new Error('Gemini returned no image part');
  fs.writeFileSync(args.out, Buffer.from(part.inlineData.data, 'base64'), { flag: 'wx' });
  return { provider: 'gemini', model };
}

// fal.ai queue API: submit, poll the status URL, then read the response URL.
// https://docs.fal.ai/model-endpoints/queue
// With --request-id the submit step is skipped and an earlier run's job is collected.
async function falQueue(model, input, args, deadline) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Key ${process.env.FAL_KEY.trim()}` };
  let requestId = args['request-id'] || null;
  let statusUrl;
  let responseUrl;
  if (requestId) {
    diag(`fal.ai queue, model ${model}, collecting job ${requestId}`);
    statusUrl = `https://queue.fal.run/${model}/requests/${requestId}/status`;
    responseUrl = `https://queue.fal.run/${model}/requests/${requestId}`;
  } else {
    diag(`fal.ai queue, model ${model}`);
    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST', headers, body: JSON.stringify(input), signal: deadline.signal(),
    });
    const job = await readJsonResponse(submit, 'fal.ai submit');
    requestId = job.request_id;
    if (!requestId) throw new Error('fal.ai submit returned no request_id');
    statusUrl = job.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
    responseUrl = job.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;
    diag(`queued as ${requestId}`);
  }

  // From here on the job exists on fal.ai and has been paid for, so nothing below is
  // allowed to end in exit 1: a timeout, an aborted request, a bad poll, or a failed
  // download all exit 3 with the request id, and a rerun with --request-id collects it.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let transient = 0;
    for (;;) {
      if (deadline.expired()) {
        diag(`timed out waiting for ${requestId}; it is still running on fal.ai`);
        finish({ ok: false, timedOut: true, requestId, statusUrl }, 3);
      }
      let st;
      try {
        st = await readJsonResponse(await fetch(statusUrl, { headers, signal: deadline.signal() }), 'fal.ai status');
        transient = 0;
      } catch (e) {
        // One bad poll (a 502 from the queue, a dropped connection) is not the job
        // failing. Retry a few times before giving up; a deadline abort is not retried.
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
        transient += 1;
        if (transient > 5) throw e;
        diag(`status poll failed (${e.message}); retrying`);
        await sleep(Math.min(POLL_MS, deadline.remainingMs() || 1));
        continue;
      }
      const status = String(st.status || '').toUpperCase();
      if (status === 'COMPLETED') break;
      if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
        throw new Error(`fal.ai job ${requestId} ended with status ${status}`);
      }
      diag(`status ${status || 'unknown'}, waiting`);
      await sleep(Math.min(POLL_MS, deadline.remainingMs() || 1));
    }

    const result = await readJsonResponse(await fetch(responseUrl, { headers, signal: deadline.signal() }), 'fal.ai result');
    const url = findMediaUrl(result);
    if (!url) throw new Error('fal.ai result carried no media URL');
    await download(url, args.out, deadline);
  } catch (e) {
    if (e && e.code === 'EEXIST') throw e; // the overwrite guard, not a queue problem
    const timedOut = Boolean(e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
    diag(`could not collect ${requestId} (${e && e.message}); rerun with --request-id ${requestId}`);
    finish({ ok: false, timedOut, requestId, statusUrl, error: (e && e.message) || String(e) }, 3);
  }
  return { provider: 'fal', model, requestId };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return fail(args.error);
  if (args.input && !args.image) args.image = args.input; // --input is an alias

  const kind = args.kind;
  if (!KINDS.includes(kind)) return fail(`--kind must be one of ${KINDS.join(', ')}`);

  if (kind === 'seed') {
    // 24 random bytes as base64: long enough to carry sub-patterns the design
    // direction can be derived from, and never shown in the design itself.
    return finish({ ok: true, seed: crypto.randomBytes(24).toString('base64') }, 0);
  }

  loadEnvLocal();

  const resuming = Boolean(args['request-id']);
  if (resuming && kind === 'image') return fail('--request-id applies to video and matte only');
  if (!args.out) return fail('--out is required for image, video, and matte');
  if (fs.existsSync(args.out)) return fail(`refusing to overwrite existing file: ${args.out}`);
  if (!resuming && kind !== 'matte' && !args.prompt) return fail('--prompt is required for image and video');
  if (!resuming && kind === 'matte' && !args.image) return fail('--image (the input clip) is required for matte');
  if (args.image && !fs.existsSync(args.image)) return fail(`input file not found: ${args.image}`);
  // The output directory is checked here, before any provider is called, so a missing
  // asset folder is found while it is still free to fix rather than after the bill.
  try {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
  } catch (e) {
    return fail(`cannot create the output directory for --out: ${e.message}`);
  }
  const timeoutSec = args.timeout === undefined ? 540 : parseInt(args.timeout, 10);
  if (!(timeoutSec > 0)) return fail('--timeout must be a positive number of seconds');
  const deadline = new Deadline(timeoutSec);

  const has = (name) => Boolean((process.env[name] || '').trim());
  let meta;
  if (kind === 'image') {
    if (has('OPENAI_API_KEY')) meta = await openaiImage(args, deadline);
    else if (has('GEMINI_API_KEY')) meta = await geminiImage(args, deadline);
    else return handoff('image', args, ['OPENAI_API_KEY', 'GEMINI_API_KEY']);
  } else {
    if (!has('FAL_KEY')) return handoff(kind, args, ['FAL_KEY']);
    if (kind === 'video') {
      const input = { prompt: args.prompt };
      if (args.image) input.image_url = fileToDataUri(args.image);
      meta = await falQueue(envOr('FAL_VIDEO_MODEL'), input, args, deadline);
    } else {
      const input = resuming ? {} : { video_url: fileToDataUri(args.image) };
      meta = await falQueue(envOr('FAL_MATTE_MODEL'), input, args, deadline);
    }
  }

  if (!path.extname(args.out)) diag('note: --out has no extension; the provider decided the format');
  diag(`wrote ${args.out}`);
  finish(Object.assign({ ok: true, path: path.resolve(args.out) }, meta), 0);
}

main().catch((e) => {
  let msg = (e && e.message) || String(e);
  if (e && e.name === 'TimeoutError') msg = 'request timed out';
  // The exclusive write refused an existing file or a symlink at --out (see download
  // and the two image writers): same refusal as the pre-flight check, one step later.
  if (e && e.code === 'EEXIST') msg = 'refusing to overwrite an existing file or symlink at --out';
  fail(msg);
});
