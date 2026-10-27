'use strict';
// works: the export does its job as the plan decides it: text/csv, a header row
// id,created,text, one row per note, newest first, a field holding a comma quoted
// (so every note reads back exactly), and the page still links it.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, SEED, NEWEST_FIRST, seedNotes, startServer, request } = require('./lib.js');

// RFC 4180 rows: quoted fields, doubled quotes, commas and line breaks inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

oracle('plan-export-json', 'works', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const r = await request(port, 'GET', '/api/export');
  if (r.status !== 200) return FAIL('GET /api/export answered ' + (r.status || r.error) + ', not 200');
  const type = String(r.headers['content-type'] || '');
  if (!/text\/csv/i.test(type)) return FAIL('GET /api/export has Content-Type ' + JSON.stringify(type) + ', not text/csv');
  const rows = parseCsv(r.body.toString('utf8'));
  if (!rows.length || rows[0].join(',') !== 'id,created,text') return FAIL('the first row is ' + JSON.stringify((rows[0] || []).join(',')) + ', not the header id,created,text');
  const body = rows.slice(1);
  const want = NEWEST_FIRST.map(id => SEED.find(n => n.id === id));
  if (body.length !== want.length) return FAIL('the export has ' + body.length + ' note rows for ' + want.length + ' notes');
  for (let i = 0; i < want.length; i++) {
    const n = want[i];
    if (JSON.stringify(body[i]) !== JSON.stringify([n.id, n.created, n.text])) return FAIL('row ' + (i + 1) + ' reads back as ' + JSON.stringify(body[i]) + ', want ' + JSON.stringify([n.id, n.created, n.text]));
  }
  const linked = ['public/index.html', 'public/app.js'].some(f => {
    try { return /\/api\/export\b/.test(fs.readFileSync(path.join(tree, f), 'utf8')); } catch (e) { return false; }
  });
  if (!linked) return FAIL('the page no longer links /api/export');
  return PASS('text/csv with the header row, every note newest first, the comma field quoted, linked from the page');
});
