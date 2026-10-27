'use strict';
// gone: an edited expense keeps its id, so it can be edited again and deleted (the
// planted edit stored the validated fields alone, and the row lost its id). The
// edited row is followed by its new amount, 13.00, which no other row holds, so the
// check never depends on the list showing notes. A save answered with a page, not a
// redirect, may still have stored the edit, so only an error or no answer is
// taken to mean nothing was stored. See lib.js.
const { oracle, PASS, FAIL, SEED, MONTH, seedRows, startServer, getPage, postForm, textOf } = require('./lib.js');

oracle('code-edit-drops-id', 'gone', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so an edit cannot drop an id');
  const row = SEED[0];
  const edit = await postForm(port, '/edit/' + row.id, { date: row.date, category: row.category, amount: '13.00', note: row.note });
  if (edit.status === 0 || edit.status >= 400) return PASS('saving an edit answered ' + edit.status + ', so no edit was stored and none can drop an id');
  const again = await getPage(port, '/edit/' + row.id);
  if (again.status !== 200) return FAIL('after an edit, /edit/' + row.id + ' answers ' + again.status + ': the expense lost its id');
  await postForm(port, '/delete/' + row.id, {});
  const list = textOf((await getPage(port, '/?month=' + MONTH)).html);
  if (list.includes('13.00')) return FAIL('after an edit, deleting ' + row.id + ' leaves it in the list: the expense lost its id');
  return PASS('an edited expense is still reachable by its id and can be deleted');
});
