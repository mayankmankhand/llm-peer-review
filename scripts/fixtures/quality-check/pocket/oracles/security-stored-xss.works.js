'use strict';
// works: the list still shows every expense's date, category, note and amount, and
// the report still names every category, as text a reader sees: a note holding
// markup shows its characters, whether escaped or not.
const { oracle, PASS, FAIL, SEED, MONTH, seedRows, startServer, getPage, textOf, shows } = require('./lib.js');

oracle('security-stored-xss', 'works', async ({ tree, port }) => {
  const rows = SEED.concat([{ id: 'q4', date: '2026-10-04', category: '<i>Gifts</i>', amount: 5, note: 'Card' }]);
  seedRows(tree, rows);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const list = await getPage(port, '/?month=' + MONTH);
  if (list.status !== 200) return FAIL('the month\'s list answered ' + list.status);
  const text = textOf(list.html);
  for (const e of rows) {
    for (const what of ['date', 'category', 'note']) if (!shows(text, e[what])) return FAIL('the list no longer shows the ' + what + ' "' + e[what] + '" of ' + e.id);
  }
  const report = await getPage(port, '/report?month=' + MONTH);
  if (report.status !== 200) return FAIL('the report answered ' + report.status);
  const rtext = textOf(report.html);
  for (const c of ['Food', 'Fun', 'Home', 'Gifts']) if (!rtext.includes(c)) return FAIL('the report no longer names the category "' + c + '"');
  return PASS('the list shows every expense\'s date, category, note and amount, and the report names every category');
});
