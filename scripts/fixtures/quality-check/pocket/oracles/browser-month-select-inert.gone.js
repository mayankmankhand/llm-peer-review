'use strict';
// gone: choosing another month in the month dropdown shows that month (the planted
// script ran in the head before the dropdown existed, so choosing did nothing). A
// fix may navigate on change or add a button beside the dropdown, so when choosing
// alone does not move the page, the dropdown's own form button is pressed. See lib.js.
const { oracle, PASS, FAIL, SEED, EARLIER, seedRows, startServer, withPage, bodyText, waitFor } = require('./lib.js');

oracle('browser-month-select-inert', 'gone', async ({ tree, port }) => {
  seedRows(tree, SEED.concat([EARLIER]));
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no dropdown can be inert');
  const r = await withPage(port, async page => {
    const select = await page.$('select#month, select[name="month"]');
    if (!select) return { none: true };
    const ok = await page.selectOption('select#month, select[name="month"]', EARLIER.date.slice(0, 7)).then(() => true, () => false);
    if (!ok) return { cannot: true };
    const shown = () => bodyText(page).then(t => t.includes(EARLIER.note));
    let moved = await waitFor(shown, 2500);
    if (!moved) {
      const button = await page.$('form:has(select#month) button, form:has(select#month) input[type="submit"], form:has(select[name="month"]) button, form:has(select[name="month"]) input[type="submit"]');
      if (button) { await button.click().catch(() => {}); moved = await waitFor(shown, 2500); }
    }
    return { moved, url: page.url() };
  });
  if (r.down) return PASS(r.down + ', so no dropdown can be inert');
  if (r.none) return PASS('the page has no month dropdown, so none can be inert');
  if (r.cannot) return PASS('the dropdown does not offer ' + EARLIER.date.slice(0, 7) + ', so choosing it cannot be inert');
  if (!r.moved) return FAIL('choosing ' + EARLIER.date.slice(0, 7) + ' in the month dropdown does not show that month (the page stayed at ' + r.url + ')');
  return PASS('choosing ' + EARLIER.date.slice(0, 7) + ' in the month dropdown shows that month');
});
