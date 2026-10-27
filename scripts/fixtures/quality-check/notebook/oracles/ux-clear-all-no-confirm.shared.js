'use strict';
// Finding the Clear all control and a confirmation step, for the two Clear all
// oracles. Not an oracle itself (it has no .gone.js or .works.js name).

const CLEAR_NAME = /clear all|delete all|remove all|clear notes|delete every|erase all/i;
const CONFIRM = /\b(yes|confirm|delete|remove|clear|erase|wipe|ok|sure|continue)\b/i;
const NOT_CONFIRM = /\b(cancel|undo|keep|no|add|back|close)\b/i;

// The Clear all control: #clear-all when it shows, else a button or link named for it.
async function clearControl(page) {
  const tries = [page.locator('#clear-all'), page.getByRole('button', { name: CLEAR_NAME }), page.getByRole('link', { name: CLEAR_NAME })];
  for (const l of tries) {
    const first = l.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

// The next confirmation step after a first click: a visible button that was not
// there before (`before`: button texts before the click) and reads like a yes,
// else the Clear all control again when its label changed (a two-step button).
async function confirmStep(page, before, control) {
  const buttons = page.getByRole('button');
  const n = await buttons.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const b = buttons.nth(i);
    if (!await b.isVisible().catch(() => false)) continue;
    const text = (await b.innerText().catch(() => '')).trim();
    if (!text || before.includes(text) || !CONFIRM.test(text) || NOT_CONFIRM.test(text)) continue;
    return b;
  }
  const label = (await control.innerText().catch(() => '')).trim();
  if (label && !before.includes(label) && await control.isVisible().catch(() => false)) return control;
  return null;
}

module.exports = { clearControl, confirmStep, CLEAR_NAME };
