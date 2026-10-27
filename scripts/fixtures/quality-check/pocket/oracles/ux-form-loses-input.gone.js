'use strict';
// gone: an add with a bad amount comes back, after any redirect, as a page that
// still holds what was typed and says the amount is the field to fix (the planted
// add redirected to an empty form saying only "Invalid input"). See lib.js.
const { oracle, PASS, FAIL, seedRows, startServer, postForm, follow, textOf } = require('./lib.js');

oracle('ux-form-loses-input', 'gone', async ({ tree, port }) => {
  seedRows(tree);
  const srv = await startServer(tree, port);
  if (!srv.up) return PASS('the server did not start (' + srv.why + '), so no form can lose input');
  const sent = await postForm(port, '/add', { date: '2026-10-06', category: 'Food', amount: 'abc', note: 'Pizza night' });
  if (sent.status === 404 || sent.status === 405 || sent.status === 0) return PASS('a post to /add answered ' + sent.status + ', so there is no add form to lose input');
  const page = await follow(port, sent);
  if (page.status === 200 && page.redirectedTo && !/\/add\b/.test(page.redirectedTo)) return PASS('the bad amount led to ' + page.redirectedTo + ', not back to a form, so no typed input was dropped');
  const kept = /value="Pizza night"/.test(page.html);
  // The message, not the field's label: labels and inputs are left out before the
  // page's words are searched for "amount".
  const message = textOf(page.html.replace(/<label\b[\s\S]*?<\/label>/gi, ' ').replace(/<(input|select|option)\b[^>]*>/gi, ' '));
  const named = /\bamount\b/i.test(message);
  if (!kept || !named) return FAIL('a rejected add ' + (kept ? '' : 'drops the typed note') + (!kept && !named ? ' and ' : '') + (named ? '' : 'does not name the amount as the field to fix') + (page.redirectedTo ? ' (redirected to ' + page.redirectedTo + ')' : ''));
  return PASS('a rejected add keeps the typed note and names the amount as the field to fix');
});
