'use strict';
// works: the month view still lists the chosen month's expenses, and only that
// month's: October shows its three and not September's, September shows its one.
const { oracle, PASS, FAIL, SEED, EARLIER, seedRows, startServer, getPage, textOf, shows } = require('./lib.js');

oracle('known-capped-total', 'works', async ({ tree, port }) => {
  seedRows(tree, SEED.concat([EARLIER]));
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const oct = await getPage(port, '/?month=2026-10');
  if (oct.status !== 200) return FAIL('the October view answered ' + oct.status);
  const otext = textOf(oct.html);
  for (const e of SEED) if (!shows(otext, e.note)) return FAIL('the October view does not list "' + e.note + '"');
  if (otext.includes(EARLIER.note)) return FAIL('the October view lists September\'s "' + EARLIER.note + '"');
  const sep = textOf((await getPage(port, '/?month=2026-09')).html);
  if (!sep.includes(EARLIER.note)) return FAIL('the September view does not list "' + EARLIER.note + '"');
  if (SEED.some(e => shows(sep, e.note))) return FAIL('the September view lists October\'s expenses');
  return PASS('each month\'s view lists that month\'s expenses and no other month\'s');
});
