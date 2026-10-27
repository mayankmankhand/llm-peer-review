'use strict';
// works: editing an expense changes it: a new amount shows in the month's list in
// place of the old one, and the other expenses' amounts are untouched. Amounts, not
// notes, so the check holds on a tree whose list shows no notes.
const { oracle, PASS, FAIL, MONTH, seedRows, SEED, startServer, getPage, postForm, textOf } = require('./lib.js');

oracle('code-edit-drops-id', 'works', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const row = SEED[0];
  const form = await getPage(port, '/edit/' + row.id);
  if (form.status !== 200) return FAIL('GET /edit/' + row.id + ' answered ' + form.status + ', not the edit form');
  const edit = await postForm(port, '/edit/' + row.id, { date: row.date, category: row.category, amount: '13.40', note: row.note });
  if (edit.status >= 400 || edit.status === 0) return FAIL('saving an edit answered ' + edit.status);
  const list = textOf((await getPage(port, '/?month=' + MONTH)).html);
  if (!list.includes('13.40')) return FAIL('the edited amount 13.40 does not show in the month\'s list');
  if (list.includes('12.50')) return FAIL('the old amount 12.50 still shows after the edit');
  for (const other of SEED.slice(1)) if (!list.includes(other.amount.toFixed(2))) return FAIL('the edit changed another expense: ' + other.id + '\'s amount ' + other.amount.toFixed(2) + ' is gone from the list');
  return PASS('an edit changes the expense\'s amount and leaves the others as they were');
});
