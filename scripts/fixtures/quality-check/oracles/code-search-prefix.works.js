'use strict';
// works: search still filters notes by text anywhere in the note, ignoring case,
// newest first, finds nothing for a word no note holds, lists every note with no
// query, and finds a note added after the server started. The leading-word case
// is the gone oracle's, so this one holds whether or not the bug is fixed.
const { oracle, PASS, FAIL, seedNotes, startServer, request, requestJson, ids } = require('./lib.js');

oracle('code-search-prefix', 'works', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const cases = [
    ['', ['n3', 'n2', 'n1'], 'no query lists every note, newest first'],
    ['dentist', ['n2'], 'a word in the middle of a note'],
    ['STAMPS', ['n2'], 'a word at the end, in other case'],
    ['E', ['n3', 'n2', 'n1'], 'a letter every note holds, newest first'],
    ['zebra', [], 'a word no note holds'],
  ];
  for (const [q, want, what] of cases) {
    const r = await requestJson(port, 'GET', '/api/notes' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const got = ids(r.json);
    if (!got) return FAIL('GET /api/notes' + (q ? '?q=' + q : '') + ' answered no list (status ' + r.status + ')');
    if (got.join(',') !== want.join(',')) return FAIL(what + ': q=' + JSON.stringify(q) + ' gave [' + got.join(',') + '], want [' + want.join(',') + ']');
  }
  const added = await request(port, 'POST', '/api/notes', { text: 'Water the plants on Friday' });
  if (added.status !== 201) return FAIL('adding a note answered ' + added.status + ', not 201');
  let note;
  try { note = JSON.parse(added.body.toString('utf8')); } catch (e) { note = null; }
  const after = await requestJson(port, 'GET', '/api/notes?q=plants');
  if (!note || !Array.isArray(after.json) || after.json.length !== 1 || after.json[0].id !== note.id) {
    return FAIL('a note added while the server runs is not found by q=plants (gave [' + (ids(after.json) || []).join(',') + '])');
  }
  return PASS('search filters by text anywhere, ignoring case, newest first; no match gives nothing; a new note is found');
});
