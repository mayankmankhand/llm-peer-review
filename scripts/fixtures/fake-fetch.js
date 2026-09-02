// fake-fetch.js - preload for scripts/test-gen-media.js.
//
// Loaded with `node --require scripts/fixtures/fake-fetch.js <script>`, so it replaces
// globalThis.fetch INSIDE the child process that runs gen-media.js. A fetch replaced in
// the test process itself would never reach a spawned child, which is why the toolkit's
// tests (all of which spawn the script under test) need a preload rather than a mock.
//
// Environment:
//   FAKE_FETCH_LOG   append one JSON line per request (url, method, auth scheme, body)
//   FAKE_FETCH_MODE  "complete" (default): the fal.ai queue finishes on the 2nd poll
//                    "never": the queue reports IN_QUEUE forever (timeout branch)
//                    "flaky": the first two status polls answer 502, then it completes
'use strict';

const fs = require('fs');

const LOG = process.env.FAKE_FETCH_LOG;
const MODE = process.env.FAKE_FETCH_MODE || 'complete';
const PNG_B64 = Buffer.from('PNGDATA-fake').toString('base64');
let statusCalls = 0;

function record(entry) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async function fakeFetch(url, init) {
  init = init || {};
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  const headers = init.headers || {};
  const auth = headers.Authorization || headers['x-goog-api-key'] || '';
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { body = String(init.body); }
  record({ url: u, method, hasAuth: Boolean(auth), authScheme: auth ? (auth.split(' ').length > 1 ? auth.split(' ')[0] : 'raw') : null, body });

  if (u.startsWith('https://api.openai.com/v1/images/generations')) {
    return json({ data: [{ b64_json: PNG_B64 }] });
  }
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    return json({ candidates: [{ content: { parts: [{ text: 'Here is your image.' }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] });
  }
  if (u.startsWith('https://queue.fal.run/') && method === 'POST') {
    const model = u.slice('https://queue.fal.run/'.length);
    return json({
      request_id: 'req_test_123',
      status_url: `https://queue.fal.run/${model}/requests/req_test_123/status`,
      response_url: `https://queue.fal.run/${model}/requests/req_test_123`,
    });
  }
  if (u.endsWith('/requests/req_test_123/status')) {
    statusCalls++;
    if (MODE === 'never') return json({ status: 'IN_QUEUE' });
    if (MODE === 'flaky' && statusCalls <= 2) return new Response('bad gateway', { status: 502 });
    return json({ status: statusCalls < 2 ? 'IN_PROGRESS' : 'COMPLETED' });
  }
  if (u.endsWith('/requests/req_test_123')) {
    return json({ video: { url: 'https://fake.local/result.mp4', content_type: 'video/mp4' } });
  }
  if (u === 'https://fake.local/result.mp4') {
    return new Response(Buffer.from('MP4DATA-fake'), { status: 200, headers: { 'content-type': 'video/mp4' } });
  }
  return new Response('not found', { status: 404 });
};
