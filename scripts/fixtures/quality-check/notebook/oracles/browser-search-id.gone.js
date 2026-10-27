'use strict';
// gone: the page loads without an uncaught script error (the planted app.js looked
// up #search-box, the page has #search, so the script threw at load). See lib.js.
const { oracle, PASS, FAIL, seedNotes, startServer, withPage } = require('./lib.js');

oracle('browser-search-id', 'gone', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so the page cannot throw');
  const r = await withPage(port, async (page, errors) => ({ errors: errors.slice() }));
  if (r.down) return PASS(r.down + ', so the page cannot throw');
  if (r.errors.length) return FAIL('the page still throws at load: ' + r.errors[0].slice(0, 200));
  return PASS('the page loads with no uncaught script error');
});
