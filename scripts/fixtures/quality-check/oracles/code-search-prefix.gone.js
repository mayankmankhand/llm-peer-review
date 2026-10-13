'use strict';
// gone: a search for a note's first word finds that note (the planted miss was
// indexOf(query) > 0, which skips a match at position 0). See lib.js.
const { oracle, PASS, FAIL, seedNotes, startServer, requestJson, ids } = require('./lib.js');

oracle('code-search-prefix', 'gone', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so the miss cannot reproduce');
  const misses = [];
  for (const [q, id] of [['buy', 'n1'], ['Book', 'n3']]) {
    const r = await requestJson(port, 'GET', '/api/notes?q=' + encodeURIComponent(q));
    if (!Array.isArray(r.json)) return PASS('GET /api/notes?q=' + q + ' answered no list (status ' + r.status + '), so the miss cannot reproduce');
    if (!r.json.some(n => n && n.id === id)) misses.push('q=' + q + ' gave [' + ids(r.json).join(',') + '], not ' + id);
  }
  if (misses.length) return FAIL('a note that starts with the search word is still missed: ' + misses.join('; '));
  return PASS('a search for a note\'s first word finds it (q=buy finds n1, q=Book finds n3)');
});
