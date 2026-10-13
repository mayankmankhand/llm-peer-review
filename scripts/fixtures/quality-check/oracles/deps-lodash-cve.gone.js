'use strict';
// gone: lodash is no longer declared or locked below 4.17.21 (the planted change
// pinned 4.17.15). Read offline from package.json and package-lock.json, the files
// npm audit reads, because npm audit itself needs the network. See lib.js.
const fs = require('fs');
const path = require('path');
const { oracle, PASS, FAIL, packageJson } = require('./lib.js');
const { FLOOR, atLeast, lowestOf } = require('./deps-lodash-cve.shared.js');

oracle('deps-lodash-cve', 'gone', async ({ tree }) => {
  const found = [];
  const pkg = packageJson(tree) || {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const spec = pkg[field] && pkg[field].lodash;
    if (spec !== undefined) found.push({ where: 'package.json ' + field, spec: String(spec), v: lowestOf(spec) });
  }
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(path.join(tree, 'package-lock.json'), 'utf8')); } catch (e) { lock = null; }
  if (lock) {
    for (const [key, entry] of Object.entries(lock.packages || {})) {
      if (/(^|\/)node_modules\/lodash$/.test(key) && entry && entry.version) found.push({ where: 'package-lock.json ' + key, spec: entry.version, v: lowestOf(entry.version) });
    }
    const v1 = lock.dependencies && lock.dependencies.lodash;
    if (v1 && v1.version) found.push({ where: 'package-lock.json dependencies.lodash', spec: v1.version, v: lowestOf(v1.version) });
  }
  if (!found.length) return PASS('lodash is no longer a dependency: package.json and package-lock.json name none');
  const low = found.filter(f => f.v && !atLeast(f.v, FLOOR));
  const show = list => list.map(f => f.where + ' ' + f.spec).join('; ');
  if (low.length) return FAIL('lodash still resolves below ' + FLOOR.join('.') + ': ' + show(low));
  return PASS('lodash is at ' + FLOOR.join('.') + ' or later everywhere it is named: ' + show(found));
});
