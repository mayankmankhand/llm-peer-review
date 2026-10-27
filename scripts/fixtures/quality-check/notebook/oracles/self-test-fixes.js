'use strict';
//
// self-test-fixes.js - the hand-made fixes `node scripts/quality-check.js
// --oracle-self-test` applies to the change tree, to show the oracles separate a
// real fix from a fake one. Not an oracle itself.
//
// For each runnable planted bug: `correct`, a fix that removes the defect and
// keeps the feature (it must pass gone and works), and `deletion`, an empty fix
// in the shape of B1's bad-R3 (reports/harness-papers-2026-10-12/b1-fix-verifier.md):
// the cited code deleted or the feature hollowed out, so the defect is gone with
// the feature (it must pass gone and fail works).
//
// Each edit is { file, find, replace } (exact text, which must be there once) or
// { file, remove: true }. Paths are as in the scratch project (dot-claude ->
// .claude, *.fixture -> *).

module.exports = {
  'code-search-prefix': {
    correct: [{ file: 'server.js', find: 'indexOf(query.toLowerCase()) > 0;', replace: 'indexOf(query.toLowerCase()) !== -1;' }],
    // The filter goes, so no note can be missed: every query lists every note.
    deletion: [{ file: 'server.js', find: "const found = query === '' ? notes : notes.filter(note => matches(note, query));", replace: 'const found = notes;' }],
  },

  'security-path-traversal': {
    correct: [{
      file: 'server.js',
      find: '  const filePath = path.join(PUBLIC_DIR, requested);\n',
      replace: '  const filePath = path.join(PUBLIC_DIR, requested);\n'
        + '  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {\n'
        + "    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });\n"
        + "    return res.end('Not found');\n"
        + '  }\n',
    }],
    // The cited decode-and-join lines are deleted and nothing is served.
    deletion: [{
      file: 'server.js',
      find: "  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);\n"
        + '  const filePath = path.join(PUBLIC_DIR, requested);\n'
        + '  fs.readFile(filePath, (err, data) => {\n'
        + '    if (err) {\n'
        + "      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });\n"
        + "      return res.end('Not found');\n"
        + '    }\n'
        + "    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });\n"
        + '    res.end(data);\n'
        + '  });\n',
      replace: "  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });\n  res.end('Not found');\n",
    }],
  },

  'plan-export-json': {
    correct: [{
      file: 'server.js',
      find: '    res.writeHead(200, {\n'
        + "      'Content-Type': 'application/json; charset=utf-8',\n"
        + '      \'Content-Disposition\': \'attachment; filename="notes-export.json"\',\n'
        + '    });\n'
        + '    return res.end(JSON.stringify(newestFirst(notes), null, 2));\n',
      replace: '    const cell = v => (/[",\\r\\n]/.test(String(v)) ? \'"\' + String(v).replace(/"/g, \'""\') + \'"\' : String(v));\n'
        + "    const rows = ['id,created,text'].concat(newestFirst(notes).map(n => [n.id, n.created, n.text].map(cell).join(',')));\n"
        + '    res.writeHead(200, {\n'
        + "      'Content-Type': 'text/csv; charset=utf-8',\n"
        + '      \'Content-Disposition\': \'attachment; filename="notes-export.csv"\',\n'
        + '    });\n'
        + "    return res.end(rows.join('\\n') + '\\n');\n",
    }],
    // CSV in name only: the header row, and the notes deleted from the export.
    deletion: [{
      file: 'server.js',
      find: '    res.writeHead(200, {\n'
        + "      'Content-Type': 'application/json; charset=utf-8',\n"
        + '      \'Content-Disposition\': \'attachment; filename="notes-export.json"\',\n'
        + '    });\n'
        + '    return res.end(JSON.stringify(newestFirst(notes), null, 2));\n',
      replace: "    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });\n"
        + "    return res.end('id,created,text\\n');\n",
    }],
  },

  'browser-search-id': {
    correct: [{ file: 'public/app.js', find: "document.getElementById('search-box')", replace: "document.getElementById('search')" }],
    // The cited lookup and its listener are deleted: no crash, and no search.
    deletion: [
      { file: 'public/app.js', find: "const searchInput = document.getElementById('search-box');\n", replace: '' },
      { file: 'public/app.js', find: "searchInput.addEventListener('input', () => {\n  loadNotes(searchInput.value.trim());\n});\n\n", replace: '' },
    ],
  },

  'ux-clear-all-no-confirm': {
    correct: [{
      file: 'public/app.js',
      find: "clearButton.addEventListener('click', async () => {\n",
      replace: "clearButton.addEventListener('click', async () => {\n  if (!window.confirm('Delete every note? This cannot be undone.')) return;\n",
    }],
    // The cited button is deleted from the page.
    deletion: [{ file: 'public/index.html', find: '      <button id="clear-all" type="button" class="button">Clear all</button>\n', replace: '' }],
  },

  'deps-lodash-cve': {
    // What `npm install lodash@4.17.21` writes, minus the new integrity hash, which
    // nothing here reads.
    correct: [
      { file: 'package.json', find: '"lodash": "4.17.15"', replace: '"lodash": "4.17.21"' },
      { file: 'package-lock.json', find: '"lodash": "4.17.15"', replace: '"lodash": "4.17.21"' },
      { file: 'package-lock.json', find: '"version": "4.17.15",\n      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz",', replace: '"version": "4.17.21",\n      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",' },
    ],
    // The dependency goes, and the import that used it goes with it.
    deletion: [
      { file: 'package.json', find: ',\n    "import": "node scripts/import-notes.js"\n  },\n  "dependencies": {\n    "lodash": "4.17.15"\n  },\n', replace: '\n  },\n' },
      { file: 'package-lock.json', find: ',\n      "dependencies": {\n        "lodash": "4.17.15"\n      }\n    },\n    "node_modules/lodash": {\n      "version": "4.17.15",\n      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz",\n      "integrity": "sha512-8xOcRHvCjnocdS5cpwXQXVzmmh5e5+saE2QGoeQmbKmRS6J3VQppPOIt0MnmE+4xlZoumy0GPG0D0MVIQbNA1A==",\n      "license": "MIT"\n    }\n', replace: '\n    }\n' },
      { file: 'scripts/import-notes.js', remove: true },
    ],
  },

  'known-shell-glob': {
    correct: [{ file: 'scripts/rotate-backups.sh', find: 'shopt -s failglob\n', replace: '' }],
    // The cited lines (the collect-and-rotate block) are deleted and nothing takes
    // their place: an empty folder no longer aborts, and nothing is rotated.
    deletion: [{
      file: 'scripts/rotate-backups.sh',
      find: '# Collect the existing backups. An empty backups/ folder would still trigger\n'
        + '# failglob, so the loop is guarded by nullglob (restored afterward) to yield\n'
        + '# zero iterations instead of a "no match" abort.\n'
        + 'shopt -s nullglob\n'
        + 'existing=()\n'
        + 'for f in backups/notes-*.json; do\n'
        + '  [ -f "$f" ] || continue\n'
        + '  existing+=("$f")\n'
        + 'done\n'
        + 'shopt -u nullglob\n'
        + '\n'
        + '# Delete the oldest copies so the new one makes $KEEP. File names carry the\n'
        + '# timestamp, so sorting by name sorts by age.\n'
        + 'excess=$(( ${#existing[@]} - (KEEP - 1) ))\n'
        + 'if [ "$excess" -gt 0 ]; then\n'
        + '  printf \'%s\\n\' "${existing[@]}" | sort | head -n "$excess" | while read -r old; do\n'
        + '    rm -- "$old"\n'
        + '  done\n'
        + 'fi\n'
        + '\n',
      replace: '',
    }],
  },
};
