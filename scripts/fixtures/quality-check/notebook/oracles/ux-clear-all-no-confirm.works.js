'use strict';
// works: Clear all still removes every note. Any dialog is accepted; when a
// confirmation step appears in the page instead (a "Delete all" button, a second
// click), it is taken; then the server must hold no notes and the list must show none.
const { oracle, PASS, FAIL, SEED, seedNotes, startServer, requestJson, withPage, bodyText, waitFor } = require('./lib.js');
const { clearControl, confirmStep } = require('./ux-clear-all-no-confirm.shared.js');

oracle('ux-clear-all-no-confirm', 'works', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const count = async () => { const r = await requestJson(port, 'GET', '/api/notes'); return Array.isArray(r.json) ? r.json.length : -1; };
  const r = await withPage(port, async page => {
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.accept().catch(() => {}); });
    const control = await clearControl(page);
    if (!control) return FAIL('there is no Clear all control on the page');
    const before = await page.getByRole('button').allInnerTexts().catch(() => []);
    await control.click({ timeout: 3000 }).catch(() => {});
    let steps = 0;
    let empty = await waitFor(async () => (await count()) === 0, 1500);
    while (!empty && steps < 2) {
      const next = await confirmStep(page, before, control);
      if (!next) break;
      steps++;
      await next.click({ timeout: 3000 }).catch(() => {});
      empty = await waitFor(async () => (await count()) === 0, 1500);
    }
    // A delete that waits for an undo window lands a few seconds later.
    if (!empty) empty = await waitFor(async () => (await count()) === 0, 7000);
    if (!empty) return FAIL('Clear all did not remove the notes (' + (await count()) + ' left' + (dialogs ? ', a dialog was accepted' : '') + (steps ? ', ' + steps + ' confirmation step(s) taken' : '') + ')');
    const cleared = await waitFor(async () => { const b = await bodyText(page); return SEED.every(n => !b.includes(n.text)); }, 3000);
    if (!cleared) return FAIL('the server holds no notes, but the page still lists them');
    return PASS('Clear all removes every note' + (dialogs ? ' after its confirmation dialog' : steps ? ' after ' + steps + ' confirmation step(s)' : ''));
  }, { stubMissing: true });
  if (r.down) return FAIL(r.down);
  return r;
});
