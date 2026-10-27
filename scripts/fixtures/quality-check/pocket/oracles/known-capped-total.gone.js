'use strict';
// gone: a month with 25 expenses reports 25, and the total of all 25 (the planted
// month view showed the newest 20 and counted and summed only those, saying nothing
// of the rest). Amounts are 1 to 25, so the full total is 325.00 and the capped
// one 310.00. A page that reports no count cannot under-report, but its list still
// can: one that shows some of the 25 must show them all or say more exist (an "of
// 25", or a link to the next or older ones), or it passes a cut list off as the
// month. Rows are told apart by amount, since a tree may not show notes. See lib.js.
const { oracle, PASS, FAIL, seedMonth, startServer, getPage, textOf } = require('./lib.js');

oracle('known-capped-total', 'gone', async ({ tree, port }) => {
  const rows = seedMonth(tree, 25, '2026-11');
  const full = rows.reduce((s, e) => s + e.amount, 0).toFixed(2);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no count can be wrong');
  const p = await getPage(port, '/?month=2026-11');
  if (p.status !== 200) return PASS('the month view answered ' + p.status + ', so no count can be wrong');
  const text = textOf(p.html);
  const counts = [...text.matchAll(/\b(\d+)\s+expenses?\b/gi)].map(m => Number(m[1]));
  if (!counts.length) {
    const shown = rows.filter(e => new RegExp('(^|[^\\d.])' + e.amount + '\\.00(?!\\d)').test(text)).length;
    if (shown === 0) return PASS('the month view lists none of the month\'s expenses, so it cannot cut the list short');
    if (shown === rows.length) return PASS('the month view reports no count and lists all ' + rows.length + ' expenses');
    if (/\b(of|all) 25\b|\b(next|more|older|earlier|show all|page \d)\b/i.test(text)) return PASS('the month view lists ' + shown + ' of ' + rows.length + ' and says more exist');
    return FAIL('a month with ' + rows.length + ' expenses lists ' + shown + ' with no count and nothing saying the rest exist');
  }
  if (!counts.includes(rows.length)) return FAIL('a month with ' + rows.length + ' expenses reports ' + counts.join(' and ') + (text.includes(full) ? '' : ', and its total is not ' + full));
  if (!text.includes(full)) return FAIL('a month with ' + rows.length + ' expenses reports the count but not the full total ' + full);
  return PASS('a month with ' + rows.length + ' expenses reports ' + rows.length + ' and the total ' + full);
});
