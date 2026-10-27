'use strict';
// gone: a note or a category that holds markup reaches the list and the report as
// text, not as markup (the planted cell() helper inserted both without escaping).
// The seeded note holds <b>qc</b>; one more row's category holds <i>Gifts</i>. See lib.js.
const { oracle, PASS, FAIL, SEED, MONTH, seedRows, startServer, getPage } = require('./lib.js');

oracle('security-stored-xss', 'gone', async ({ tree, port }) => {
  seedRows(tree, SEED.concat([{ id: 'q4', date: '2026-10-04', category: '<i>Gifts</i>', amount: 5, note: 'Card' }]));
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no page can carry markup');
  const raw = [];
  for (const [url, mark] of [['/?month=' + MONTH, '<b>qc</b>'], ['/?month=' + MONTH, '<i>Gifts</i>'], ['/report?month=' + MONTH, '<i>Gifts</i>']]) {
    const p = await getPage(port, url);
    if (p.status === 200 && p.html.includes(mark)) raw.push(url + ' carries ' + mark + ' as markup');
  }
  if (raw.length) return FAIL('stored markup still reaches the page unescaped: ' + raw.join('; '));
  return PASS('the note\'s and the category\'s markup reach the list and the report escaped (or not at all)');
});
