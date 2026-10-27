'use strict';
// Moves one month's expenses out of data/expenses.json into archive/<month>.json.
// Usage: npm run close -- --month YYYY-MM

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'expenses.json');
const ARCHIVE_DIR = path.join(ROOT, 'archive');

const at = process.argv.indexOf('--month');
const month = at === -1 ? '' : String(process.argv[at + 1] || '');
if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: npm run close -- --month YYYY-MM');
  process.exit(1);
}

const expenses = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const closing = expenses.filter(e => e.date.startsWith(month + '-'));
const keep = expenses.filter(e => !e.date.startsWith(month + '-'));

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const file = path.join(ARCHIVE_DIR, month + '.json');
const earlier = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
fs.writeFileSync(file, JSON.stringify(earlier.concat(closing), null, 2) + '\n');
fs.writeFileSync(DATA_FILE, JSON.stringify(keep, null, 2) + '\n');
console.log('Moved ' + closing.length + ' expenses from ' + month + ' into archive/' + month + '.json.');
