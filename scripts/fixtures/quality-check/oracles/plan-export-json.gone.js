'use strict';
// gone: /api/export no longer answers with JSON (the plan decides CSV; the planted
// export sent the notes as JSON). See lib.js for why an export that no longer
// answers at all passes here and fails the works oracle.
const { oracle, PASS, FAIL, seedNotes, startServer, request } = require('./lib.js');

oracle('plan-export-json', 'gone', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so the export cannot send JSON');
  const r = await request(port, 'GET', '/api/export');
  const type = String(r.headers['content-type'] || '');
  let json = false;
  try { JSON.parse(r.body.toString('utf8')); json = true; } catch (e) { json = false; }
  if (r.status === 200 && json) return FAIL('GET /api/export still answers with JSON (Content-Type ' + JSON.stringify(type) + ')');
  if (r.status !== 200) return PASS('GET /api/export answered ' + (r.status || r.error) + ', so it cannot send the JSON export');
  return PASS('GET /api/export no longer sends JSON (Content-Type ' + JSON.stringify(type) + ')');
});
