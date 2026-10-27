'use strict';
// works: the list page still has its month dropdown, offering every month that has
// expenses, and shows the newest month's expenses.
const { oracle, PASS, FAIL, SEED, EARLIER, seedRows, startServer, withPage, bodyText } = require('./lib.js');

oracle('browser-month-select-inert', 'works', async ({ tree, port }) => {
  seedRows(tree, SEED.concat([EARLIER]));
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const r = await withPage(port, async page => {
    const options = await page.$$eval('select#month option, select[name="month"] option', os => os.map(o => o.value || o.textContent.trim())).catch(() => []);
    return { options, text: await bodyText(page) };
  });
  if (r.down) return FAIL(r.down);
  if (!r.options.length) return FAIL('the list page has no month dropdown');
  for (const m of ['2026-10', '2026-09']) if (!r.options.includes(m)) return FAIL('the month dropdown does not offer ' + m + ' (it offers ' + r.options.join(', ') + ')');
  if (!r.text.includes('Light bulbs') || !r.text.includes('Lunch, with Sam')) return FAIL('the list page does not show the newest month\'s expenses');
  return PASS('the list page has its month dropdown with both months and shows the newest month\'s expenses');
});
