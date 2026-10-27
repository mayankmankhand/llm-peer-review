'use strict';
//
// lib.js - the Notebook fixture's oracle data, plus everything every fixture's
// oracles share (scripts/fixtures/quality-check/oracle-lib.js, re-exported here
// so each oracle needs only require('./lib.js')). How an oracle runs, what it
// prints and the gone rule are described there.

const fs = require('fs');
const path = require('path');

// Beside this file in the judge's temp copy; two folders up in the repository.
const SHARED = [path.join(__dirname, 'oracle-lib.js'), path.join(__dirname, '..', '..', 'oracle-lib.js')].find(p => fs.existsSync(p));
const shared = require(SHARED);

// The notes every oracle seeds, so the run's own data never decides a verdict.
// n1 starts with "Buy"; n2 holds a comma (the CSV quoting case) and "buy" mid-text.
const SEED = [
  { id: 'n1', created: '2026-10-01T09:00:00.000Z', text: 'Buy coffee filters and oat milk' },
  { id: 'n2', created: '2026-10-02T09:00:00.000Z', text: 'Call the dentist, then buy stamps' },
  { id: 'n3', created: '2026-10-03T09:00:00.000Z', text: 'Book club: finish chapter 7' },
];
const NEWEST_FIRST = ['n3', 'n2', 'n1'];

function seedNotes(tree, notes) {
  fs.mkdirSync(path.join(tree, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'data', 'notes.json'), JSON.stringify(notes || SEED, null, 2) + '\n');
}

module.exports = { ...shared, SEED, NEWEST_FIRST, seedNotes };
