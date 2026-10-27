'use strict';
// gone: no encoded dot-dot path reads a file outside public/ (the planted bug
// joined decodeURIComponent(pathname) onto public/ with no containment check, so
// /..%2fserver.js served the server's source). See lib.js.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, seedNotes, startServer, request } = require('./lib.js');

oracle('security-path-traversal', 'gone', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so nothing can be read through it');
  const targets = ['server.js', 'data/notes.json', 'package.json', 'README.md'].filter(t => fs.existsSync(path.join(tree, t)));
  const enc = t => t.split('/').map(encodeURIComponent).join('%2f');
  const leaks = [];
  for (const t of targets) {
    const bytes = fs.readFileSync(path.join(tree, t));
    const tries = ['/..%2f' + enc(t), '/%2e%2e%2f' + enc(t), '/x/..%2f..%2f' + enc(t), '/..%2f..%2f' + encodeURIComponent(path.basename(tree)) + '%2f' + enc(t)];
    for (const p of tries) {
      const r = await request(port, 'GET', p);
      if (r.status === 200 && r.body.equals(bytes)) { leaks.push('GET ' + p + ' returns ' + t); break; }
    }
  }
  if (leaks.length) return FAIL('files outside public/ are still served: ' + leaks.join('; '));
  return PASS('no encoded dot-dot path reads a file outside public/ (' + targets.length + ' files tried, 4 paths each)');
});
