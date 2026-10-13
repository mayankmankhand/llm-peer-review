'use strict';
// works: the note list renders, and typing in the search box filters it (the
// feature the planted lookup broke): "dentist" leaves only that note, and
// clearing the box brings every note back.
const { oracle, PASS, FAIL, SEED, seedNotes, startServer, withPage, bodyText, waitFor } = require('./lib.js');

async function searchBox(page) {
  const tries = [page.getByRole('searchbox'), page.getByLabel(/search/i), page.locator('input[id*="search" i]'), page.getByPlaceholder(/search|filter/i)];
  for (const l of tries) {
    const first = l.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

oracle('browser-search-id', 'works', async ({ tree, port }) => {
  seedNotes(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return FAIL('the server did not start: ' + srv.why);
  const texts = SEED.map(n => n.text);
  const shows = (body, list) => list.every(t => body.includes(t));
  const hides = (body, list) => list.every(t => !body.includes(t));
  const r = await withPage(port, async page => {
    if (!await waitFor(async () => shows(await bodyText(page), texts), 3000)) return FAIL('the note list never shows the three notes');
    const box = await searchBox(page);
    if (!box) return FAIL('no search box on the page');
    await box.fill('dentist');
    const only = [SEED[1].text];
    const others = [SEED[0].text, SEED[2].text];
    if (!await waitFor(async () => { const b = await bodyText(page); return shows(b, only) && hides(b, others); }, 3000)) {
      return FAIL('typing "dentist" in the search box does not narrow the list to that note');
    }
    await box.fill('');
    if (!await waitFor(async () => shows(await bodyText(page), texts), 3000)) return FAIL('clearing the search box does not bring every note back');
    return PASS('the list renders; "dentist" narrows it to one note; clearing the box shows all three');
  });
  if (r.down) return FAIL(r.down);
  return r;
});
