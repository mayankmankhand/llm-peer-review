'use strict';
// Add notes from a CSV file with one note per line: created,text
// Usage: npm run import -- notes.csv

const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const DATA_FILE = path.join(__dirname, '..', 'data', 'notes.json');

function parseLine(line) {
  const comma = line.indexOf(',');
  if (comma === -1) return null;
  const created = line.slice(0, comma).trim();
  const text = line.slice(comma + 1).trim();
  if (text === '' || Number.isNaN(Date.parse(created))) return null;
  return { created: new Date(created).toISOString(), text };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run import -- <file.csv>');
    process.exit(1);
  }
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(parseLine).filter(Boolean);
  const notes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const added = rows.map((row, i) => ({ id: Date.now().toString(36) + i, ...row }));
  const merged = _.uniqBy(notes.concat(added), note => note.created + '\n' + note.text);
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2) + '\n');
  console.log('Imported ' + (merged.length - notes.length) + ' notes.');
}

main();
