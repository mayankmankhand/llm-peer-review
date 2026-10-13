'use strict';
// gone: one click on Clear all no longer wipes every note with no confirmation and
// no undo. The click is made with any dialog dismissed (the cautious answer); the
// notes are counted on the server. Element lookups that find nothing get a stand-in
// (lib.js), so the planted search-box crash cannot hide this bug. See lib.js.
const { oracle, PASS, FAIL, SEED, seedNotes, startServer, requestJson, withPage, waitFor } = require('./lib.js');
const { clearControl } = require('./ux-clear-all-no-confirm.shared.js');

oracle('ux-clear-all-no-confirm', 'gone', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no click can wipe the notes');
  const count = async () => { const r = await requestJson(port, 'GET', '/api/notes'); return Array.isArray(r.json) ? r.json.length : -1; };
  const r = await withPage(port, async page => {
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.dismiss().catch(() => {}); });
    const control = await clearControl(page);
    if (!control) return PASS('there is no Clear all control, so one click cannot wipe the notes');
    await control.click({ timeout: 3000 }).catch(() => {});
    await new Promise(res => setTimeout(res, 1500));
    const left = await count();
    if (left === SEED.length) return PASS('one click on Clear all keeps every note' + (dialogs ? ' (a confirmation dialog asked first, and was dismissed)' : ' (nothing was deleted on the first click)'));
    const undo = page.getByRole('button', { name: /undo/i }).or(page.getByRole('link', { name: /undo/i })).first();
    if (await undo.isVisible().catch(() => false)) {
      await undo.click({ timeout: 3000 }).catch(() => {});
      const back = await waitFor(async () => (await count()) === SEED.length, 3000);
      if (back) return PASS('Clear all wipes the notes, and Undo brings them back');
      return FAIL('Clear all wiped the notes and its Undo did not bring them back');
    }
    return FAIL('one click on Clear all deleted ' + (left < 0 ? 'the notes' : (SEED.length - left) + ' of ' + SEED.length + ' notes') + ' with no confirmation and no undo');
  }, { stubMissing: true });
  if (r.down) return PASS(r.down + ', so no click can wipe the notes');
  return r;
});
