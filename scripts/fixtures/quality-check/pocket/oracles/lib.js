'use strict';
//
// lib.js - the Pocket fixture's oracle data and form helpers, plus everything every
// fixture's oracles share (scripts/fixtures/quality-check/oracle-lib.js, re-exported
// here so each oracle needs only require('./lib.js')). How an oracle runs, what it
// prints and the gone rule are described there.

const fs = require('fs');
const http = require('http');
const path = require('path');

// Beside this file in the judge's temp copy; two folders up in the repository.
const SHARED = [path.join(__dirname, 'oracle-lib.js'), path.join(__dirname, '..', '..', 'oracle-lib.js')].find(p => fs.existsSync(p));
const shared = require(SHARED);

// The rows every oracle seeds, so the run's own data never decides a verdict: three
// expenses in one month, one note holding a comma (the CSV quoting case) and one
// holding markup (the escaping case). Their amounts total 39.75.
const MONTH = '2026-10';
const SEED = [
  { id: 'q1', date: '2026-10-01', category: 'Food', amount: 12.5, note: 'Lunch, with Sam' },
  { id: 'q2', date: '2026-10-02', category: 'Fun', amount: 7.25, note: '<b>qc</b> board games' },
  { id: 'q3', date: '2026-10-03', category: 'Home', amount: 20, note: 'Light bulbs' },
];
const SEED_TOTAL = '39.75';
const NEWEST_FIRST = ['q3', 'q2', 'q1'];
// One expense in the month before, for the oracles that switch months.
const EARLIER = { id: 'q0', date: '2026-09-28', category: 'Transport', amount: 2.75, note: 'Bus fare' };

function seedRows(tree, rows) {
  fs.mkdirSync(path.join(tree, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'data', 'expenses.json'), JSON.stringify(rows || SEED, null, 2) + '\n');
}

// `count` expenses in one month, the i-th dated day i (cycling after the 28th) with
// amount i and note "Row i"; returns them.
function seedMonth(tree, count, month) {
  const m = month || '2026-11';
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({ id: 'm' + i, date: m + '-' + String(((i - 1) % 28) + 1).padStart(2, '0'), category: 'Food', amount: i, note: 'Row ' + i });
  }
  seedRows(tree, rows);
  return rows;
}

// A form post the way the browser sends one; never rejects (status 0: no answer).
function postForm(port, urlPath, fields) {
  return new Promise(resolve => {
    const body = new URLSearchParams(fields).toString();
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: urlPath, agent: false, timeout: 5000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', e => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0) }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer within 5 s')));
    req.on('error', e => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0) }));
    req.write(body);
    req.end();
  });
}

// A page by GET, as { status, html }.
async function getPage(port, urlPath) {
  const r = await shared.request(port, 'GET', urlPath);
  return { status: r.status, headers: r.headers, html: r.body.toString('utf8') };
}

// Where a response leads: the page its redirect names, else the response itself.
async function follow(port, r) {
  if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
    const u = new URL(r.headers.location, 'http://127.0.0.1');
    return Object.assign(await getPage(port, u.pathname + u.search), { redirectedTo: u.pathname + u.search });
  }
  return { status: r.status, headers: r.headers, html: r.body.toString('utf8') };
}

// A page's visible text: scripts and styles dropped, tags stripped, the common
// entities decoded, so escaped markup reads as the characters a reader sees.
function textOf(html) {
  return String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// Does a page's visible text show `value`? A value holding markup counts when its
// characters show (escaped) or its words do (rendered), so the check holds whether
// or not the page escapes it.
function shows(text, value) {
  const v = String(value);
  return text.includes(v) || text.includes(v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

module.exports = { ...shared, MONTH, SEED, SEED_TOTAL, NEWEST_FIRST, EARLIER, seedRows, seedMonth, postForm, getPage, follow, textOf, shows };
