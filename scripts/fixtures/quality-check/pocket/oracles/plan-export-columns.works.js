'use strict';
// works: the export still works: text/csv with a header row, one row per expense,
// newest first, and the note that holds a comma quoted so it stays one field. The
// columns are found by their header names, so this holds whether or not the column
// order is fixed.
const { oracle, PASS, FAIL, SEED, NEWEST_FIRST, seedRows, startServer, getPage } = require('./lib.js');
const { parseCsv } = require('./plan-export-columns.shared.js');

oracle('plan-export-columns', 'works', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const r = await getPage(port, '/export.csv');
  if (r.status !== 200) return FAIL('GET /export.csv answered ' + r.status);
  if (!/text\/csv/i.test(String(r.headers['content-type'] || ''))) return FAIL('the export\'s Content-Type is "' + r.headers['content-type'] + '", not text/csv');
  const rows = parseCsv(r.html);
  const header = (rows[0] || []).map(h => h.trim().toLowerCase());
  const at = name => header.indexOf(name);
  if (at('date') === -1 || at('note') === -1) return FAIL('the export\'s header has no date and note columns: ' + header.join(','));
  const data = rows.slice(1);
  if (data.length !== SEED.length) return FAIL('the export has ' + data.length + ' rows for ' + SEED.length + ' expenses');
  const byDate = Object.fromEntries(SEED.map(e => [e.date, e.id]));
  const order = data.map(row => byDate[row[at('date')]] || '?');
  if (order.join(',') !== NEWEST_FIRST.join(',')) return FAIL('the rows are not newest first: ' + order.join(','));
  const notes = data.map(row => row[at('note')]);
  if (!notes.includes(SEED[0].note)) return FAIL('the note "' + SEED[0].note + '" does not come back as one field: ' + JSON.stringify(notes));
  return PASS('text/csv with a header row, every expense newest first, the comma-holding note quoted');
});
