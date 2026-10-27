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
const PAGE_SIZE = 20;

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

// Choosing a month reloads the list for that month.
const MONTH_SCRIPT = '<script>\n'
  + 'const select = document.getElementById("month");\n'
  + 'if (select) {\n'
  + '  select.addEventListener("change", () => { location.href = "/?month=" + select.value; });\n'
  + '}\n'
  + '</script>';

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

function monthOf(date) {
  return String(date).slice(0, 7);
}

// Every month that has expenses, newest first.
function months() {
  return [...new Set(expenses.map(e => monthOf(e.date)))].sort().reverse();
}

// The month a page shows: the one asked for, else the newest month with expenses.
function pickMonth(asked) {
  if (/^\d{4}-\d{2}$/.test(asked || '')) return asked;
  return months()[0] || new Date().toISOString().slice(0, 7);
}

function page(title, body, head) {
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<title>' + esc(title) + ' - Pocket</title>\n<style>\n' + STYLE + '\n</style>\n' + (head ? head + '\n' : '') + '</head>\n<body>\n'
    + '<h1><a href="/">Pocket</a></h1>\n' + body + '\n</body>\n</html>\n';
}

// One table cell; the content may hold markup, such as a row's links.
function cell(content, className) {
  return '<td' + (className ? ' class="' + className + '"' : '') + '>' + content + '</td>';
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

// The form for adding or editing an expense.
function expenseForm(title, action, button, values, message) {
  const v = values || {};
  return page(title,
    (message ? '<p class="error" role="alert">' + esc(message) + '</p>\n' : '')
    + '<form method="post" action="' + esc(action) + '">\n'
    + '<label for="date">Date</label><input id="date" name="date" type="date" required value="' + esc(v.date || '') + '">\n'
    + '<label for="category">Category</label><select id="category" name="category">' + categoryOptions(v.category) + '</select>\n'
    + '<label for="amount">Amount</label><input id="amount" name="amount" inputmode="decimal" required value="' + esc(v.amount || '') + '">\n'
    + '<label for="note">Note</label><input id="note" name="note" maxlength="' + MAX_NOTE_LENGTH + '" value="' + esc(v.note || '') + '">\n'
    + '<p><button type="submit">' + esc(button) + '</button> <a href="/">Cancel</a></p>\n</form>');
}

function addForm(failed) {
  return expenseForm('Add an expense', '/add', 'Add', {}, failed ? 'Invalid input' : '');
}

function rowHtml(e) {
  const actions = '<a href="/edit/' + e.id + '">Edit</a> '
    + '<form method="post" action="/delete/' + e.id + '" class="inline"><button type="submit">Delete</button></form>';
  return '<tr>' + cell(e.date) + cell(e.category) + cell(e.note) + cell(money(e.amount), 'num') + cell(actions) + '</tr>';
}

function listPage(asked) {
  const month = pickMonth(asked);
  const all = months();
  const options = (all.includes(month) ? all : [month].concat(all))
    .map(m => '<option value="' + esc(m) + '"' + (m === month ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
  const rows = newestFirst(expenses.filter(e => monthOf(e.date) === month)).slice(0, PAGE_SIZE);
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  return page('Expenses for ' + month,
    '<p><a href="/add">Add an expense</a> | <a href="/report?month=' + esc(month) + '">Report</a> | <a href="/export.csv">Export CSV</a></p>\n'
    + '<p><label for="month">Month</label><select id="month" name="month">' + options + '</select></p>\n'
    + '<p class="summary">' + rows.length + (rows.length === 1 ? ' expense, ' : ' expenses, ') + money(total) + ' in total</p>\n'
    + '<table>\n<thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>\n<tbody>\n'
    + rows.map(rowHtml).join('\n')
    + '\n</tbody>\n</table>', MONTH_SCRIPT);
}

function reportPage(asked) {
  const month = pickMonth(asked);
  const groups = new Map();
  for (const e of expenses.filter(x => monthOf(x.date) === month)) {
    const g = groups.get(e.category) || { category: e.category, count: 0, total: 0 };
    g.count += 1;
    g.total += e.amount;
    groups.set(e.category, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = list.reduce((sum, g) => sum + g.total, 0);
  return page('Report for ' + month,
    '<p><a href="/?month=' + esc(month) + '">Back to the list</a></p>\n'
    + '<table>\n<thead><tr><th>Category</th><th class="num">Expenses</th><th class="num">Total</th></tr></thead>\n<tbody>\n'
    + list.map(g => '<tr>' + cell(g.category) + cell(g.count, 'num') + cell(money(g.total), 'num') + '</tr>').join('\n')
    + '\n</tbody>\n<tfoot><tr>' + cell('All') + cell('', 'num') + cell(money(total), 'num') + '</tr></tfoot>\n</table>');
}

function csvField(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function exportCsv(res) {
  const lines = ['id,date,amount,category,note'];
  for (const e of newestFirst(expenses)) lines.push([e.id, e.date, e.amount, e.category, e.note].map(csvField).join(','));
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="expenses.csv"' });
  res.end(lines.join('\n') + '\n');
}

async function handle(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, listPage(url.searchParams.get('month')));
  if (req.method === 'GET' && url.pathname === '/report') return send(res, 200, reportPage(url.searchParams.get('month')));
  if (req.method === 'GET' && url.pathname === '/export.csv') return exportCsv(res);
  if (req.method === 'GET' && url.pathname === '/add') return send(res, 200, addForm(url.searchParams.has('error')));
  if (req.method === 'POST' && url.pathname === '/add') {
    const checked = validate(await readForm(req));
    if (checked.error) return redirect(res, '/add?error=1');
    expenses.push({ id: newId(), ...checked.value });
    saveExpenses(expenses);
    return redirect(res, '/?month=' + monthOf(checked.value.date));
  }
  const edit = /^\/edit\/([^/]+)$/.exec(url.pathname);
  if (edit) {
    const index = expenses.findIndex(e => e.id === edit[1]);
    if (index === -1) return send(res, 404, page('Not found', '<p>There is no such expense. <a href="/">Back to the list</a></p>'));
    const action = '/edit/' + edit[1];
    if (req.method === 'GET') return send(res, 200, expenseForm('Edit an expense', action, 'Save', expenses[index], ''));
    if (req.method === 'POST') {
      const fields = await readForm(req);
      const checked = validate(fields);
      if (checked.error) return send(res, 400, expenseForm('Edit an expense', action, 'Save', fields, checked.error));
      expenses[index] = checked.value;
      saveExpenses(expenses);
      return redirect(res, '/?month=' + monthOf(checked.value.date));
    }
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
