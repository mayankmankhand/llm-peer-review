'use strict';
// works: the static handler still serves the app's files under public/ with their
// types, and a new asset in a subfolder needs no route of its own (the plan's Step
// 4: "serve every file in public/ without a route per file"); a missing file is a 404.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, seedNotes, startServer, request } = require('./lib.js');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>\n';

oracle('security-path-traversal', 'works', async ({ tree, port }) => {
  seedNotes(tree);
  fs.mkdirSync(path.join(tree, 'public', 'img'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'public', 'img', 'dot.svg'), SVG);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const cases = [
    ['/', 'index.html', /text\/html/],
    ['/index.html', 'index.html', /text\/html/],
    ['/app.js', 'app.js', /javascript/],
    ['/style.css', 'style.css', /text\/css/],
    ['/img/dot.svg', 'img/dot.svg', /image\/svg\+xml/],
  ];
  for (const [url, file, type] of cases) {
    const abs = path.join(tree, 'public', file);
    if (!fs.existsSync(abs)) return FAIL('public/' + file + ' is gone from the tree');
    const r = await request(port, 'GET', url);
    if (r.status !== 200) return FAIL('GET ' + url + ' answered ' + (r.status || r.error) + ', not 200');
    if (!r.body.equals(fs.readFileSync(abs))) return FAIL('GET ' + url + ' did not return public/' + file);
    if (!type.test(String(r.headers['content-type'] || ''))) return FAIL('GET ' + url + ' has Content-Type ' + JSON.stringify(r.headers['content-type'] || '') + ', want ' + type.source);
  }
  const missing = await request(port, 'GET', '/no-such-file.css');
  if (missing.status !== 404) return FAIL('GET /no-such-file.css answered ' + (missing.status || missing.error) + ', not 404');
  return PASS('serves /, index.html, app.js, style.css and a new img/dot.svg with their types; a missing file is a 404');
});
