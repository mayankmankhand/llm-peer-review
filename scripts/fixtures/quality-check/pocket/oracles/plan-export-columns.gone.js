'use strict';
// gone: /export.csv has the columns the plan decided, date,category,amount,note in
// that order, and every amount with two decimals (the planted export wrote
// id,date,amount,category,note with the amounts as stored). See lib.js.
const { oracle, PASS, FAIL, seedRows, startServer, getPage } = require('./lib.js');
const { parseCsv } = require('./plan-export-columns.shared.js');

const PLANNED = 'date,category,amount,note';

oracle('plan-export-columns', 'gone', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no export can differ from the plan');
  const r = await getPage(port, '/export.csv');
  if (r.status !== 200) return PASS('GET /export.csv answered ' + r.status + ', so no export can differ from the plan');
  const rows = parseCsv(r.html);
  const header = (rows[0] || []).join(',');
  if (header !== PLANNED) return FAIL('the export\'s header is "' + header + '", not the planned ' + PLANNED);
  const loose = rows.slice(1).map(row => row[2]).filter(a => !/^\d+\.\d{2}$/.test(String(a)));
  if (loose.length) return FAIL('amounts without two decimals: ' + loose.slice(0, 3).join(', '));
  return PASS('the export has the planned columns and two-decimal amounts');
});
