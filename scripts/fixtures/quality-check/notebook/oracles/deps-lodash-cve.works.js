'use strict';
// works: `npm run import -- <file.csv>` still adds the new rows, skips a row that
// duplicates a note and a row with no valid date, and keeps every existing note.
//
// No network means no real lodash: when the tree still depends on lodash and has
// none installed, the judge puts a stand-in in node_modules/lodash with uniqBy as
// lodash documents it. Any other lodash function stops the import with a marker,
// and the oracle reports UNJUDGED rather than guess.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, SEED, Unjudged, seedNotes, packageJson, npmRun, lastLine } = require('./lib.js');

const STANDIN = [
  "'use strict';",
  '// The quality-check judge\'s offline stand-in for lodash: uniqBy only.',
  'function iteratee(f) { return typeof f === \'function\' ? f : f == null ? (x => x) : (x => (x == null ? undefined : x[f])); }',
  'function uniqBy(array, f) {',
  '  const fn = iteratee(f);',
  '  const seen = new Set();',
  '  const out = [];',
  '  for (const x of array || []) { const k = fn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }',
  '  return out;',
  '}',
  'module.exports = new Proxy({ uniqBy }, { get(t, k) {',
  '  if (k in t || typeof k === \'symbol\' || k === \'__esModule\' || k === \'then\' || k === \'default\') return t[k];',
  '  throw new Error(\'QC_STANDIN_MISSING:\' + String(k));',
  '} });',
  '',
].join('\n');

const CSV = [
  '2026-10-04T10:00:00.000Z,Renew the library card',
  SEED[0].created + ',' + SEED[0].text,
  'not a date,This line is skipped',
  '2026-10-05T08:30:00.000Z,Plan the weekend hike',
  '',
].join('\n');
const NEW = [['2026-10-04T10:00:00.000Z', 'Renew the library card'], ['2026-10-05T08:30:00.000Z', 'Plan the weekend hike']];

oracle('deps-lodash-cve', 'works', async ({ tree }) => {
  seedNotes(tree);
  const pkg = packageJson(tree);
  if (!pkg) return FAIL('the tree has no readable package.json');
  if (!pkg.scripts || !pkg.scripts.import) return FAIL('package.json has no import script');
  const declared = ['dependencies', 'devDependencies', 'optionalDependencies'].some(f => pkg[f] && pkg[f].lodash !== undefined);
  const standIn = declared && !fs.existsSync(path.join(tree, 'node_modules', 'lodash'));
  if (standIn) {
    const dir = path.join(tree, 'node_modules', 'lodash');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'lodash', version: '0.0.0-qc-stand-in', main: 'index.js' }) + '\n');
    fs.writeFileSync(path.join(dir, 'index.js'), STANDIN);
  }
  fs.writeFileSync(path.join(tree, 'incoming.csv'), CSV);
  const r = npmRun(tree, 'import', ['incoming.csv']);
  const missing = /QC_STANDIN_MISSING:(\S+)/.exec(r.err + r.out);
  if (missing) throw new Unjudged('the import calls lodash.' + missing[1] + ', which the judge\'s offline stand-in does not provide; install lodash to judge');
  if (r.status !== 0) return FAIL('npm run import exited ' + r.status + ': ' + lastLine(r.err || r.out).slice(0, 200));
  let notes;
  try { notes = JSON.parse(fs.readFileSync(path.join(tree, 'data', 'notes.json'), 'utf8')); } catch (e) { return FAIL('data/notes.json is not readable JSON after the import'); }
  if (!Array.isArray(notes)) return FAIL('data/notes.json is not a list after the import');
  for (const n of SEED) if (!notes.some(x => x && x.id === n.id && x.text === n.text)) return FAIL('the import lost the existing note ' + n.id);
  if (notes.filter(x => x && x.text === SEED[0].text).length !== 1) return FAIL('the row that duplicates note n1 was added again');
  if (notes.some(x => x && x.text === 'This line is skipped')) return FAIL('the row with no valid date was imported');
  for (const [created, text] of NEW) {
    if (notes.filter(x => x && x.text === text && x.created === created).length !== 1) return FAIL('the new row "' + text + '" was not imported once with its date');
  }
  if (notes.length !== SEED.length + NEW.length) return FAIL('the import left ' + notes.length + ' notes, want ' + (SEED.length + NEW.length));
  return PASS('npm run import adds the two new rows and skips the duplicate and the undated row' + (standIn ? ' (lodash: the judge\'s uniqBy stand-in)' : ''));
});
