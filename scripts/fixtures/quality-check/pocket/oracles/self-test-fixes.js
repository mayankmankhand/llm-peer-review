'use strict';
//
// self-test-fixes.js - the hand-made fixes `node scripts/quality-check.js
// --oracle-self-test --fixture pocket` applies to Pocket's change tree, to show the
// oracles separate a real fix from a fake one. Not an oracle itself.
//
// For each runnable planted bug: `correct`, a fix that removes the defect and
// keeps the feature (it must pass gone and works), and `deletion`, an empty fix
// in the shape of B1's bad-R3 (reports/harness-papers-2026-10-12/b1-fix-verifier.md):
// the cited code deleted or the feature hollowed out, so the defect is gone with
// the feature (it must pass gone and fail works).
//
// Each edit is { file, find, replace } (exact text, which must be there once) or
// { file, remove: true }. Paths are as in the scratch project (dot-claude ->
// .claude, *.fixture -> *). In server.js, a `\\n` in a find is the two characters
// the source holds inside its string literals; a `\n` is a real line end.

module.exports = {
  'code-edit-drops-id': {
    correct: [{ file: 'server.js', find: '      expenses[index] = checked.value;\n', replace: '      expenses[index] = { id: expenses[index].id, ...checked.value };\n' }],
    // Saving an edit goes: the form still opens, and nothing it sends is stored.
    deletion: [{
      file: 'server.js',
      find: "    if (req.method === 'POST') {\n"
        + '      const fields = await readForm(req);\n'
        + '      const checked = validate(fields);\n'
        + "      if (checked.error) return send(res, 400, expenseForm('Edit an expense', action, 'Save', fields, checked.error));\n"
        + '      expenses[index] = checked.value;\n'
        + '      saveExpenses(expenses);\n'
        + "      return redirect(res, '/?month=' + monthOf(checked.value.date));\n"
        + '    }\n',
      replace: '',
    }],
  },

  'security-stored-xss': {
    correct: [
      { file: 'server.js', find: 'cell(e.date) + cell(e.category) + cell(e.note)', replace: 'cell(esc(e.date)) + cell(esc(e.category)) + cell(esc(e.note))' },
      { file: 'server.js', find: "'<tr>' + cell(g.category) + cell(g.count, 'num')", replace: "'<tr>' + cell(esc(g.category)) + cell(g.count, 'num')" },
    ],
    // The note and category cells go from the list and the category from the report.
    deletion: [
      { file: 'server.js', find: 'cell(e.date) + cell(e.category) + cell(e.note) + ', replace: 'cell(e.date) + ' },
      { file: 'server.js', find: "'<tr>' + cell(g.category) + cell(g.count, 'num')", replace: "'<tr>' + cell(g.count, 'num')" },
    ],
  },

  'ux-form-loses-input': {
    correct: [{
      file: 'server.js',
      find: '    const checked = validate(await readForm(req));\n'
        + "    if (checked.error) return redirect(res, '/add?error=1');\n",
      replace: '    const fields = await readForm(req);\n'
        + '    const checked = validate(fields);\n'
        + "    if (checked.error) return send(res, 400, expenseForm('Add an expense', '/add', 'Add', fields, checked.error));\n",
    }],
    // Adding goes: the form still opens, and nothing it sends is stored.
    deletion: [{
      file: 'server.js',
      find: "  if (req.method === 'POST' && url.pathname === '/add') {\n"
        + '    const checked = validate(await readForm(req));\n'
        + "    if (checked.error) return redirect(res, '/add?error=1');\n"
        + '    expenses.push({ id: newId(), ...checked.value });\n'
        + '    saveExpenses(expenses);\n'
        + "    return redirect(res, '/?month=' + monthOf(checked.value.date));\n"
        + '  }\n',
      replace: '',
    }],
  },

  'browser-month-select-inert': {
    // The script waits for the page to be parsed before it looks for the dropdown.
    correct: [
      { file: 'server.js', find: "const MONTH_SCRIPT = '<script>\\n'", replace: "const MONTH_SCRIPT = '<script>document.addEventListener(\"DOMContentLoaded\", () => {\\n'" },
      { file: 'server.js', find: "  + '</script>';", replace: "  + '});</script>';" },
    ],
    // The dropdown goes from the list page.
    deletion: [{
      file: 'server.js',
      find: "    + '<p><label for=\"month\">Month</label><select id=\"month\" name=\"month\">' + options + '</select></p>\\n'\n",
      replace: '',
    }],
  },

  'plan-export-columns': {
    correct: [
      { file: 'server.js', find: "const lines = ['id,date,amount,category,note'];", replace: "const lines = ['date,category,amount,note'];" },
      { file: 'server.js', find: '[e.id, e.date, e.amount, e.category, e.note]', replace: '[e.date, e.category, money(e.amount), e.note]' },
    ],
    // The export goes.
    deletion: [{ file: 'server.js', find: "  if (req.method === 'GET' && url.pathname === '/export.csv') return exportCsv(res);\n", replace: '' }],
  },

  'deps-moment-cve': {
    // What `npm install moment@2.29.4` writes.
    correct: [
      { file: 'package.json', find: '"moment": "2.29.1"', replace: '"moment": "2.29.4"' },
      { file: 'package-lock.json', find: '"moment": "2.29.1"', replace: '"moment": "2.29.4"' },
      {
        file: 'package-lock.json',
        find: '"version": "2.29.1",\n'
          + '      "resolved": "https://registry.npmjs.org/moment/-/moment-2.29.1.tgz",\n'
          + '      "integrity": "sha512-kHmoybcPV8Sqy59DwNDY3Jefr64lK/by/da0ViFcuA4DH0vQg5Q6Ze5VimxkfQNSC+Mls/Kx53s7TjP1RhFEDQ==",',
        replace: '"version": "2.29.4",\n'
          + '      "resolved": "https://registry.npmjs.org/moment/-/moment-2.29.4.tgz",\n'
          + '      "integrity": "sha512-5LC9SOxjSc2HF6vO2CyuTDNivEdoz2IvyJJGj6X8DJ0eFyfszE0QiEd+iXmBvUP3WHxSjFH/vIsA0EN00cgr8w==",',
      },
    ],
    // The dependency goes, and the import that used it goes with it.
    deletion: [
      { file: 'package.json', find: '    "import": "node scripts/import-expenses.js",\n', replace: '' },
      { file: 'package.json', find: '  "dependencies": {\n    "moment": "2.29.1"\n  },\n', replace: '' },
      {
        file: 'package-lock.json',
        find: ',\n      "dependencies": {\n        "moment": "2.29.1"\n      }\n    },\n    "node_modules/moment": {\n'
          + '      "version": "2.29.1",\n'
          + '      "resolved": "https://registry.npmjs.org/moment/-/moment-2.29.1.tgz",\n'
          + '      "integrity": "sha512-kHmoybcPV8Sqy59DwNDY3Jefr64lK/by/da0ViFcuA4DH0vQg5Q6Ze5VimxkfQNSC+Mls/Kx53s7TjP1RhFEDQ==",\n'
          + '      "license": "MIT",\n      "engines": {\n        "node": "*"\n      }\n    }\n',
        replace: '\n    }\n',
      },
      { file: 'scripts/import-expenses.js', remove: true },
    ],
  },

  'known-capped-total': {
    correct: [{ file: 'server.js', find: '.filter(e => monthOf(e.date) === month)).slice(0, PAGE_SIZE);', replace: '.filter(e => monthOf(e.date) === month));' }],
    // The month's count line and its table go: the view shows only its links and dropdown.
    deletion: [{
      file: 'server.js',
      find: "\n    + '<p class=\"summary\">' + rows.length + (rows.length === 1 ? ' expense, ' : ' expenses, ') + money(total) + ' in total</p>\\n'\n"
        + "    + '<table>\\n<thead><tr><th>Date</th><th>Category</th><th>Note</th><th class=\"num\">Amount</th><th></th></tr></thead>\\n<tbody>\\n'\n"
        + "    + rows.map(rowHtml).join('\\n')\n"
        + "    + '\\n</tbody>\\n</table>', MONTH_SCRIPT);",
      replace: ', MONTH_SCRIPT);',
    }],
  },
};
