'use strict';
// Pocket: a small expense tracker with no dependencies.
// Expenses live in data/expenses.json; every page is rendered here.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'expenses.json');
const CATEGORIES = ['Food', 'Transport', 'Home', 'Fun', 'Other'];
const MAX_NOTE_LENGTH = 200;

const STYLE = [
  'body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1f2933; }',
  'h1 a { color: inherit; text-decoration: none; }',
  'table { border-collapse: collapse; width: 100%; }',
  'th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #e4e7eb; }',
  '.num { text-align: right; }',
  '.summary { color: #52606d; }',
  '.error { color: #b91c1c; font-weight: 600; }',
  'form.inline { display: inline; }',
  'label { display: block; margin: .6rem 0 .2rem; }',
].join('\n');

function loadExpenses() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveExpenses(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2) + '\n');
}

let expenses = loadExpenses();

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(amount) {
  return Number(amount).toFixed(2);
}

function newestFirst(list) {
  return list.slice().sort((a, b) => b.date.localeCompare(a.date));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function page(title, body) {
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<title>' + esc(title) + ' - Pocket</title>\n<style>\n' + STYLE + '\n</style>\n</head>\n<body>\n'
    + '<h1><a href="/">Pocket</a></h1>\n' + body + '\n</body>\n</html>\n';
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10000) {
        reject(new Error('form too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

// Checks a submitted expense. Returns { value } when it is good, or { field, error }
// naming the first field to fix.
function validate(fields) {
  const date = String(fields.date || '').trim();
  const category = String(fields.category || '').trim();
  const amountText = String(fields.amount || '').trim();
  const note = String(fields.note || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { field: 'date', error: 'Enter the date as YYYY-MM-DD, for example 2026-10-05.' };
  if (!CATEGORIES.includes(category)) return { field: 'category', error: 'Choose a category from the list.' };
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) return { field: 'amount', error: 'Enter the amount as a number above zero, for example 12.50.' };
  if (note.length > MAX_NOTE_LENGTH) return { field: 'note', error: 'Keep the note to ' + MAX_NOTE_LENGTH + ' characters or fewer.' };
  return { value: { date, category, amount: Number(amountText), note } };
}

function categoryOptions(chosen) {
  return CATEGORIES.map(c => '<option' + (c === chosen ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
}

// The add form, holding whatever was typed and the message for the field to fix.
function addForm(values, message) {
  const v = values || {};
  return page('Add an expense',
    (message ? '<p class="error" role="alert">' + esc(message) + '</p>\n' : '')
    + '<form method="post" action="/add">\n'
    + '<label for="date">Date</label><input id="date" name="date" type="date" required value="' + esc(v.date || '') + '">\n'
    + '<label for="category">Category</label><select id="category" name="category">' + categoryOptions(v.category) + '</select>\n'
    + '<label for="amount">Amount</label><input id="amount" name="amount" inputmode="decimal" required value="' + esc(v.amount || '') + '">\n'
    + '<label for="note">Note</label><input id="note" name="note" maxlength="' + MAX_NOTE_LENGTH + '" value="' + esc(v.note || '') + '">\n'
    + '<p><button type="submit">Add</button> <a href="/">Cancel</a></p>\n</form>');
}

function listPage() {
  const rows = newestFirst(expenses);
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  return page('Expenses',
    '<p><a href="/add">Add an expense</a></p>\n'
    + '<p class="summary">' + rows.length + (rows.length === 1 ? ' expense, ' : ' expenses, ') + money(total) + ' in total</p>\n'
    + '<table>\n<thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>\n<tbody>\n'
    + rows.map(e => '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.category) + '</td><td>' + esc(e.note) + '</td>'
      + '<td class="num">' + money(e.amount) + '</td>'
      + '<td><form method="post" action="/delete/' + esc(e.id) + '" class="inline"><button type="submit">Delete</button></form></td></tr>').join('\n')
    + '\n</tbody>\n</table>');
}

async function handle(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, listPage());
  if (req.method === 'GET' && url.pathname === '/add') return send(res, 200, addForm({}, ''));
  if (req.method === 'POST' && url.pathname === '/add') {
    const fields = await readForm(req);
    const checked = validate(fields);
    if (checked.error) return send(res, 400, addForm(fields, checked.error));
    expenses.push({ id: newId(), ...checked.value });
    saveExpenses(expenses);
    return redirect(res, '/');
  }
  const del = /^\/delete\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'POST' && del) {
    expenses = expenses.filter(e => e.id !== del[1]);
    saveExpenses(expenses);
    return redirect(res, '/');
  }
  return send(res, 404, page('Not found', '<p>There is no page here. <a href="/">Back to the list</a></p>'));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  handle(req, res, url).catch(err => send(res, 500, page('Error', '<p>Something went wrong: ' + esc(err.message) + '</p>')));
});

server.listen(PORT, () => {
  console.log('Pocket running at http://localhost:' + PORT);
});
