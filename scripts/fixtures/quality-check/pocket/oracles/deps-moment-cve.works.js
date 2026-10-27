'use strict';
// works: `npm run import -- <file.csv>` still adds the new rows, skips a row whose
// date is not a real date and a row whose note is already in the list, and keeps
// every existing expense.
//
// No network means no real moment: when the tree still depends on moment and has
// none installed, the judge puts a stand-in in node_modules/moment providing only
// moment(text, 'YYYY-MM-DD', true) with .isValid() and .format('YYYY-MM-DD'), as
// moment documents them. Any other call stops the import with a marker, and the
// oracle reports UNJUDGED rather than guess.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, SEED, Unjudged, seedRows, packageJson, npmRun, lastLine } = require('./lib.js');

const STANDIN = [
  "'use strict';",
  "// The quality-check judge's offline stand-in for moment: strict YYYY-MM-DD parsing only.",
  'function missing(what) { throw new Error(\'QC_STANDIN_MISSING:\' + what); }',
  'function guard(obj, prefix) {',
  '  return new Proxy(obj, { get(t, k) {',
  "    if (k in t || typeof k === 'symbol' || k === '__esModule' || k === 'then' || k === 'default') return t[k];",
  '    return missing(prefix + String(k));',
  '  } });',
  '}',
  'function moment(text, format, strict) {',
  "  if (format !== 'YYYY-MM-DD' || strict !== true) missing('moment(text, ' + JSON.stringify(format) + ', ' + String(strict) + ')');",
  '  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(text === undefined ? \'\' : text));',
  '  let valid = false;',
  '  if (m) {',
  '    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));',
  '    valid = d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);',
  '  }',
  '  return guard({',
  '    isValid: () => valid,',
  "    format: f => { if (f !== 'YYYY-MM-DD') missing('format(' + JSON.stringify(f) + ')'); return valid ? m[1] + '-' + m[2] + '-' + m[3] : 'Invalid date'; },",
  "  }, 'moment().');",
  '}',
  "module.exports = guard(moment, 'moment.');",
  '',
].join('\n');

const CSV = [
  'date,category,amount,note',
  '2026-10-04,Transport,3.10,Train ticket',
  '2026-02-30,Food,5,Never happened',
  '2026-10-05,Food,12.50,"' + SEED[0].note + '"',
  '2026-10-06,Fun,8,"Concert, balcony"',
  '',
].join('\n');
const NEW = [['2026-10-04', 'Train ticket', 3.1], ['2026-10-06', 'Concert, balcony', 8]];

oracle('deps-moment-cve', 'works', async ({ tree }) => {
  seedRows(tree);
  const pkg = packageJson(tree);
  if (!pkg) return FAIL('the tree has no readable package.json');
  if (!pkg.scripts || !pkg.scripts.import) return FAIL('package.json has no import script');
  const declared = ['dependencies', 'devDependencies', 'optionalDependencies'].some(f => pkg[f] && pkg[f].moment !== undefined);
  const standIn = declared && !fs.existsSync(path.join(tree, 'node_modules', 'moment'));
  if (standIn) {
    const dir = path.join(tree, 'node_modules', 'moment');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'moment', version: '0.0.0-qc-stand-in', main: 'index.js' }) + '\n');
    fs.writeFileSync(path.join(dir, 'index.js'), STANDIN);
  }
  fs.writeFileSync(path.join(tree, 'incoming.csv'), CSV);
  const r = npmRun(tree, 'import', ['incoming.csv']);
  const marker = /QC_STANDIN_MISSING:(\S+)/.exec(r.err + r.out);
  if (marker) throw new Unjudged('the import calls ' + marker[1] + ', which the judge\'s offline stand-in for moment does not provide; install moment to judge');
  if (r.status !== 0) return FAIL('npm run import exited ' + r.status + ': ' + lastLine(r.err || r.out).slice(0, 200));
  let rows;
  try { rows = JSON.parse(fs.readFileSync(path.join(tree, 'data', 'expenses.json'), 'utf8')); } catch (e) { return FAIL('data/expenses.json is not readable JSON after the import'); }
  if (!Array.isArray(rows)) return FAIL('data/expenses.json is not a list after the import');
  for (const e of SEED) if (!rows.some(x => x && x.id === e.id && x.note === e.note)) return FAIL('the import lost the existing expense ' + e.id);
  if (rows.filter(x => x && x.note === SEED[0].note).length !== 1) return FAIL('the row that repeats the note of ' + SEED[0].id + ' was added again');
  if (rows.some(x => x && x.note === 'Never happened')) return FAIL('the row dated 2026-02-30 was imported');
  for (const [date, note, amount] of NEW) {
    if (rows.filter(x => x && x.note === note && x.date === date && Number(x.amount) === amount).length !== 1) return FAIL('the new row "' + note + '" was not imported once with its date and amount');
  }
  if (rows.length !== SEED.length + NEW.length) return FAIL('the import left ' + rows.length + ' expenses, want ' + (SEED.length + NEW.length));
  return PASS('npm run import adds the two new rows and skips the impossible date and the repeated note' + (standIn ? ' (moment: the judge\'s strict-parse stand-in)' : ''));
});
