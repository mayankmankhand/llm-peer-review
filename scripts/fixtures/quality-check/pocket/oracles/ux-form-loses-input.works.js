'use strict';
// works: adding still works: a valid expense is saved and shows in its month's
// list, and an expense with a bad amount is not saved.
const { oracle, PASS, FAIL, seedRows, startServer, getPage, postForm, textOf } = require('./lib.js');

oracle('ux-form-loses-input', 'works', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const form = await getPage(port, '/add');
  if (form.status !== 200 || !/<form\b/i.test(form.html)) return FAIL('GET /add answered ' + form.status + (form.status === 200 ? ' with no form' : ''));
  const bad = await postForm(port, '/add', { date: '2026-10-06', category: 'Food', amount: 'abc', note: 'Pizza night' });
  const good = await postForm(port, '/add', { date: '2026-10-07', category: 'Fun', amount: '9.50', note: 'Museum' });
  if (good.status >= 400 || good.status === 0) return FAIL('a valid add answered ' + good.status);
  const list = textOf((await getPage(port, '/?month=2026-10')).html);
  if (!list.includes('Museum') || !list.includes('9.50')) return FAIL('a valid add (Museum, 9.50) does not show in the month\'s list');
  if (list.includes('Pizza night')) return FAIL('the add with a bad amount was saved (status ' + bad.status + ')');
  return PASS('a valid expense is added and listed; one with a bad amount is not saved');
});
