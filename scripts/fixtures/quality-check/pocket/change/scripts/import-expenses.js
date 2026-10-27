'use strict';
// Adds expenses from a CSV file with the columns date,category,amount,note.
// Usage: npm run import -- <file.csv>
// A row whose date is not a real date, or whose note is already in the list, is skipped.

const fs = require('fs');
const path = require('path');
const moment = require('moment');

const DATA_FILE = path.join(__dirname, '..', 'data', 'expenses.json');

// One CSV line as its fields; a quoted field may hold commas and doubled quotes.
function parseLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else field += ch;
  }
  fields.push(field);
  return fields.map(f => f.trim());
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import -- <file.csv>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '');
const header = parseLine(lines.shift() || '').map(h => h.toLowerCase());
const column = name => header.indexOf(name);
const expenses = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const notes = new Set(expenses.map(e => e.note));
let added = 0;
let skipped = 0;

for (const line of lines) {
  const row = parseLine(line);
  const date = moment(row[column('date')], 'YYYY-MM-DD', true);
  const amount = Number(row[column('amount')]);
  const note = row[column('note')] || '';
  if (!date.isValid() || !(amount > 0) || notes.has(note)) {
    skipped++;
    continue;
  }
  expenses.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: date.format('YYYY-MM-DD'),
    category: row[column('category')] || 'Other',
    amount,
    note,
  });
  notes.add(note);
  added++;
}

fs.writeFileSync(DATA_FILE, JSON.stringify(expenses, null, 2) + '\n');
console.log('Added ' + added + (added === 1 ? ' expense' : ' expenses') + ', skipped ' + skipped + '.');
