#!/usr/bin/env node
'use strict';
// test-env-local.js - assertions for .claude/scripts/env-local.js, the one .env.local
// lookup behind ask-gpt.js, ask-gemini.js, and gen-media.js (issue #177).
//
// Every case builds its own fake project and fake home directory under the OS temp dir
// and passes them in as cwd and homedir, so the real ~/.claude/plugins/.env.local and
// this repo's own .env.local are never read. Key values are made up and assembled at
// runtime, so no real-shaped key sits in the source. Dependency-free; prints one line
// per check; exits non-zero on any failure.
//
// Sections 6 to 8 cover the hardening from the issue #177 verifier notes: only the
// allowed names load from a file (a base URL, proxy, or NODE_OPTIONS in a cloned repo's
// .env.local must never reach process.env), a whitespace-only environment value counts
// as unset, and an unreadable file is skipped with one warning instead of a crash (that
// case is skipped when running as root, which reads a mode 000 file anyway).
//
//   node scripts/test-env-local.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', '.claude', 'scripts', 'env-local.js');
const lib = require(MODULE);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

const temps = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'env-local-' + label + '-'));
  temps.push(d);
  return d;
}

// A fake layout: <base>/outer/repo is the git root, <base>/outer/repo/src/deep is a
// nested working directory, and <base>/home is the home directory holding the machine
// file at .claude/plugins/.env.local.
function layout(label) {
  const base = tmp(label);
  const repo = path.join(base, 'outer', 'repo');
  const nested = path.join(repo, 'src', 'deep');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return {
    base, repo, nested, home,
    project: (text) => write(repo, '.env.local', text),
    machine: (text) => write(home, path.join('.claude', 'plugins', '.env.local'), text),
  };
}

const KEY = {
  env: 'sk-' + 'test-from-environment',
  project: 'sk-' + 'test-from-project',
  machine: 'sk-' + 'test-from-machine',
  above: 'sk-' + 'test-from-above-the-repo',
};

// One NAME=value line for a fixture file. The name and the value are joined at runtime
// and never sit in one quoted string with the =, because the pre-push tripwire's
// secret-assignment pattern reads a quoted key name followed by = and a long quoted run
// as a secret, however the made-up value itself is split.
function envLine(name, value) {
  return [name, value].join('=') + '\n';
}

// --- 1. Order -----------------------------------------------------------------------
console.log('\n1. lookup order');
{
  const l = layout('env-wins');
  l.project(envLine('OPENAI_API_KEY', KEY.project));
  l.machine(envLine('OPENAI_API_KEY', KEY.machine));
  const env = { OPENAI_API_KEY: KEY.env };
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('a real environment variable wins over both files', env.OPENAI_API_KEY === KEY.env, env.OPENAI_API_KEY);
  check('both files are still read for the keys the environment leaves out', res.read.length === 2, JSON.stringify(res));
}
{
  const l = layout('nested');
  const file = l.project(envLine('GEMINI_API_KEY', KEY.project));
  const env = {};
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('the project file is found from a nested working directory below the git root', env.GEMINI_API_KEY === KEY.project && res.project === file, JSON.stringify(res));
  check('no machine file is reported when there is none', res.machine === null && res.read.length === 1 && res.read[0] === file, JSON.stringify(res));
}
{
  const l = layout('project-wins');
  l.project(envLine('OPENAI_API_KEY', KEY.project) + 'GPT_MODEL=project-model\n');
  const machineFile = l.machine(envLine('OPENAI_API_KEY', KEY.machine) + 'GPT_MODEL=machine-model\n' + envLine('FAL_KEY', KEY.machine));
  const env = {};
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('the project file wins over the machine file for the same key', env.OPENAI_API_KEY === KEY.project, env.OPENAI_API_KEY);
  check('a model variable follows the same order', env.GPT_MODEL === 'project-model', env.GPT_MODEL);
  check('the machine file fills a key the project file leaves out', env.FAL_KEY === KEY.machine, env.FAL_KEY);
  check('read lists the project file first, then the machine file', res.read.length === 2 && res.read[0] === res.project && res.read[1] === machineFile, JSON.stringify(res));
}
{
  const l = layout('machine-only');
  const machineFile = l.machine('export GEMINI_API_KEY="' + KEY.machine + '"\n');
  const env = {};
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('the machine file is used when the project has none', env.GEMINI_API_KEY === KEY.machine && res.project === null && res.machine === machineFile, JSON.stringify(res));
}
{
  const l = layout('blank-project');
  l.project('OPENAI_API_KEY=\nGEMINI_API_KEY=""\n');
  l.machine(envLine('OPENAI_API_KEY', KEY.machine) + envLine('GEMINI_API_KEY', KEY.machine));
  const env = {};
  lib.loadEnvLocal({ cwd: l.repo, homedir: l.home, env });
  check('a blank key in the project file (copied from the example) does not hide the machine key', env.OPENAI_API_KEY === KEY.machine && env.GEMINI_API_KEY === KEY.machine, JSON.stringify(env));
}

// --- 2. Where the project search stops ---------------------------------------------
console.log('\n2. the project search stops at the git root');
{
  const l = layout('stop');
  write(path.join(l.base, 'outer'), '.env.local', envLine('OPENAI_API_KEY', KEY.above));
  const env = {};
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('a .env.local above the git root is not read', env.OPENAI_API_KEY === undefined && res.project === null, JSON.stringify(res));
  l.project(envLine('OPENAI_API_KEY', KEY.project));
  const env2 = {};
  lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env: env2 });
  check('the git root itself is still searched', env2.OPENAI_API_KEY === KEY.project, env2.OPENAI_API_KEY);
}
{
  // A worktree or submodule has a .git FILE, not a folder; it is the root all the same.
  const base = tmp('worktree');
  const wt = path.join(base, 'wt');
  write(wt, '.git', 'gitdir: /somewhere/else\n');
  fs.mkdirSync(path.join(wt, 'pkg'), { recursive: true });
  write(base, '.env.local', envLine('OPENAI_API_KEY', KEY.above));
  const env = {};
  lib.loadEnvLocal({ cwd: path.join(wt, 'pkg'), homedir: path.join(base, 'nohome'), env });
  check('a .git file (worktree) also ends the search', env.OPENAI_API_KEY === undefined, env.OPENAI_API_KEY);
}
{
  // The nearest file wins: a nested .env.local below the root shadows the root's one.
  const l = layout('nearest');
  l.project(envLine('OPENAI_API_KEY', KEY.project) + 'GPT_MODEL=root-model\n');
  write(l.nested, '.env.local', envLine('OPENAI_API_KEY', KEY.env));
  const env = {};
  const res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('only the nearest project .env.local is read', env.OPENAI_API_KEY === KEY.env && env.GPT_MODEL === undefined && res.project === path.join(l.nested, '.env.local'), JSON.stringify(res));
}
{
  // Running from inside ~/.claude/plugins itself: the machine file is not read twice.
  const base = tmp('same-file');
  const plugins = path.join(base, '.claude', 'plugins');
  const file = write(plugins, '.env.local', envLine('OPENAI_API_KEY', KEY.machine));
  fs.mkdirSync(path.join(base, '.git'));
  const env = {};
  const res = lib.loadEnvLocal({ cwd: plugins, homedir: base, env });
  check('when the project search lands on the machine file it is read once', env.OPENAI_API_KEY === KEY.machine && res.project === file && res.machine === null && res.read.length === 1, JSON.stringify(res));
}

// --- 3. Nothing to read -------------------------------------------------------------
console.log('\n3. no files');
{
  const l = layout('none');
  const env = { KEEP: 'me' };
  let res;
  let threw = null;
  try { res = lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env }); } catch (e) { threw = e; }
  check('no .env.local anywhere is not an error', threw === null, threw && threw.message);
  check('with no files nothing is read and the environment is untouched', res && res.read.length === 0 && res.project === null && res.machine === null && JSON.stringify(env) === '{"KEEP":"me"}', JSON.stringify(res));
  // A .env.local that is a directory is not a file to read.
  fs.mkdirSync(path.join(l.repo, '.env.local'));
  let threw2 = null;
  try { lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env: {} }); } catch (e) { threw2 = e; }
  check('a .env.local that is a directory is skipped, not read', threw2 === null, threw2 && threw2.message);
}

// --- 4. Parsing parity with the three copies this module replaced -------------------
console.log('\n4. parsing parity');
// FROZEN: the parse loop ask-gpt.js, ask-gemini.js, and gen-media.js each carried before
// issue #177, with process.env swapped for an env object. Do not edit it to match the
// module; it is the reference the module must keep agreeing with.
function frozenLoad(envContent, env) {
  envContent.split('\n').forEach(line => {
    // Skip empty lines and comments
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }

    const match = trimmedLine.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      // Strip surrounding quotes (single or double) that some tutorials show
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      // Only set if not already in environment
      if (!env[key]) {
        env[key] = value;
      }
    }
  });
}
const PARITY_TEXT = [
  '# a comment line',
  '   # an indented comment',
  '',
  'PLAIN=plain-value',
  'DOUBLE="double quoted"',
  "SINGLE='single quoted'",
  'MISMATCHED="half\'',
  'ONLY_OPEN="open',
  'INNER=a "quoted" middle',
  'export EXPORTED=exported-value',
  'export   SPACED_EXPORT = spaced',
  '  PADDED  =   padded value   ',
  'EQUALS=a=b=c',
  'HASH=value # not an inline comment',
  'EMPTY=',
  'EMPTY_QUOTES=""',
  'DUP=first',
  'DUP=second',
  'LATE=',
  'LATE=filled-later',
  'no equals sign here',
  '=no-key',
  'DOLLAR=$HOME and `ticks`',
  'CRLF_LINE=crlf-value\r',
  'QUOTED_CRLF="crlf quoted"\r',
  '\r',
  // The same shapes again under names the loader accepts, so the loader comparison
  // below is not trivially two empty objects. No quoted value follows an *_API_KEY name
  // (the pre-push tripwire reads that as a secret assignment).
  'GPT_MODEL="double-quoted-model"',
  "GEMINI_MODEL='single-quoted-model'",
  'export GPT_MAX_TOKENS=4000',
  '  GEMINI_MAX_TOKENS  =   8000   ',
  'FAL_VIDEO_MODEL=fal-ai/a=b',
  'FAL_MATTE_MODEL="half\'',
  'OPENAI_IMAGE_MODEL=',
  'OPENAI_IMAGE_MODEL=filled-later',
  'GEMINI_IMAGE_MODEL=first',
  'GEMINI_IMAGE_MODEL=second',
  'GEMINI_USE_CONCAT_PROMPT=1 # not an inline comment',
  'GEN_MEDIA_POLL_MS=25\r',
  'LAST=no-trailing-newline',
].join('\n');
// Two env objects hold the same pairs, whatever order they were set in.
function sameEnv(a, b) {
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return norm(a) === norm(b);
}
function pick(obj, names) {
  const out = {};
  for (const k of Object.keys(obj)) if (names.includes(k)) out[k] = obj[k];
  return out;
}
{
  const l = layout('parity');
  for (const [label, text] of [['LF', PARITY_TEXT], ['CRLF', PARITY_TEXT.replace(/\r?\n/g, '\r\n')]]) {
    const expected = {};
    frozenLoad(text, expected);
    // The parser, every name: folding parseEnvLocal's pairs with the old first-non-empty
    // rule gives exactly what the old copies set.
    const folded = {};
    for (const [k, v] of lib.parseEnvLocal(text)) if (!folded[k]) folded[k] = v;
    check('parsing matches the old copies (' + label + ' file)', JSON.stringify(folded) === JSON.stringify(expected), JSON.stringify(folded) + ' vs ' + JSON.stringify(expected));
    // The loader: the old result cut down to the allowed names.
    l.project(text);
    const actual = {};
    lib.loadEnvLocal({ cwd: l.repo, homedir: l.home, env: actual });
    const allowedExpected = pick(expected, lib.ALLOWED_KEYS);
    // Ten allowed names appear in PARITY_TEXT; all ten must survive the cut.
    check('loading matches the old copies for the allowed names (' + label + ' file)', Object.keys(allowedExpected).length === 10 && sameEnv(actual, allowedExpected), JSON.stringify(actual) + ' vs ' + JSON.stringify(allowedExpected));
  }
  const expected = {};
  frozenLoad(PARITY_TEXT, expected);
  // Spot checks, so a regression in both copies at once is still caught.
  check('quotes: one matching pair is stripped, mismatched quotes are kept', expected.DOUBLE === 'double quoted' && expected.SINGLE === 'single quoted' && expected.MISMATCHED === '"half\'' && expected.ONLY_OPEN === '"open', JSON.stringify(expected));
  check('export prefix and padding are dropped', expected.EXPORTED === 'exported-value' && expected.SPACED_EXPORT === 'spaced' && expected.PADDED === 'padded value', JSON.stringify(expected));
  check('comments are skipped and a # inside a value is kept', !Object.keys(expected).some(k => k.startsWith('#')) && expected.HASH === 'value # not an inline comment', JSON.stringify(expected));
  check('CRLF line endings leave no carriage return in a value', expected.CRLF_LINE === 'crlf-value' && expected.QUOTED_CRLF === 'crlf quoted', JSON.stringify(expected));
  check('the first non-empty value of a key wins inside one file', expected.DUP === 'first' && expected.LATE === 'filled-later', JSON.stringify(expected));
  check('only the first = splits, and $ and backticks are not expanded', expected.EQUALS === 'a=b=c' && expected.DOLLAR === '$HOME and `ticks`', JSON.stringify(expected));
  check('parseEnvLocal returns the pairs in file order', lib.parseEnvLocal('A=1\nexport B="2"\n# C=3\n').map(p => p.join('=')).join(',') === 'A=1,B=2');
}

// --- 5. Defaults and messages -------------------------------------------------------
console.log('\n5. defaults and messages');
{
  // No options: the working directory, the home directory, and process.env, in a child
  // process whose HOME and cwd are the fake layout.
  const l = layout('defaults');
  l.project(envLine('OPENAI_API_KEY', KEY.project) + envLine('GEMINI_API_KEY', KEY.project));
  l.machine(envLine('GEMINI_API_KEY', KEY.machine) + envLine('FAL_KEY', KEY.machine));
  const code = 'const m = require(' + JSON.stringify(MODULE) + '); m.loadEnvLocal(); process.stdout.write(JSON.stringify({ o: process.env.OPENAI_API_KEY, g: process.env.GEMINI_API_KEY, f: process.env.FAL_KEY }));';
  const r = spawnSync(process.execPath, ['-e', code], { cwd: l.nested, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: l.home, USERPROFILE: l.home, OPENAI_API_KEY: KEY.env } });
  let got = null;
  try { got = JSON.parse(r.stdout); } catch (e) { got = null; }
  check('with no options it uses process.cwd(), the home directory, and process.env in that order', r.status === 0 && got && got.o === KEY.env && got.g === KEY.project && got.f === KEY.machine, r.stdout + r.stderr);
}
{
  const d = lib.describeLookup();
  check('describeLookup names all three places', d.includes('the environment') && d.includes("the project's .env.local") && d.includes('~/.claude/plugins/.env.local'), d);
  check('lookupPlaces lists the three places in lookup order', lib.lookupPlaces().length === 3 && /environment/.test(lib.lookupPlaces()[0]) && /project/.test(lib.lookupPlaces()[1]) && /plugins/.test(lib.lookupPlaces()[2]));
  check('machineEnvLocalPath is ~/.claude/plugins/.env.local', lib.machineEnvLocalPath('/h') === path.join('/h', '.claude', 'plugins', '.env.local'));
}

// Run loadEnvLocal() with no options in a child process whose working directory is cwd
// and whose HOME is home, with exactly the given environment (plus PATH). The child
// prints { before, after, res }: its whole process.env before and after the call, and
// the call's return value.
function childLoad(cwd, home, env) {
  const code = 'const m = require(' + JSON.stringify(MODULE) + '); const before = Object.assign({}, process.env); const res = m.loadEnvLocal(); process.stdout.write(JSON.stringify({ before, after: Object.assign({}, process.env), res }));';
  const r = spawnSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8', env: Object.assign({ PATH: process.env.PATH, HOME: home, USERPROFILE: home }, env || {}) });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// --- 6. Only known names load from a file -------------------------------------------
console.log('\n6. only known names load from a file');
{
  // The list itself, spelled out, so a name added or dropped is a visible test change.
  const EXPECTED = ['OPENAI_API_KEY', 'GPT_MODEL', 'GPT_MAX_TOKENS', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_MAX_TOKENS', 'GEMINI_USE_CONCAT_PROMPT', 'OPENAI_IMAGE_MODEL', 'GEMINI_IMAGE_MODEL', 'FAL_KEY', 'FAL_VIDEO_MODEL', 'FAL_MATTE_MODEL', 'GEN_MEDIA_POLL_MS'];
  check('ALLOWED_KEYS is exactly the expected list', JSON.stringify(lib.ALLOWED_KEYS.slice().sort()) === JSON.stringify(EXPECTED.slice().sort()), JSON.stringify(lib.ALLOWED_KEYS));
  check('ALLOWED_KEYS cannot be changed at runtime', Object.isFrozen(lib.ALLOWED_KEYS));
  check('no allowed name is a base URL, a proxy, or a NODE_* variable', !lib.ALLOWED_KEYS.some((k) => /BASE_URL|PROXY|^NODE_/i.test(k)), JSON.stringify(lib.ALLOWED_KEYS));

  // The list matches what the scripts read: every process.env.NAME, process.env['NAME'],
  // and the names gen-media.js passes to its envOr() and has() helpers (which read
  // process.env[name]).
  const scriptsDir = path.dirname(MODULE);
  const read = new Set();
  for (const f of ['ask-gpt.js', 'ask-gemini.js', 'gen-media.js', 'env-local.js']) {
    const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8');
    for (const re of [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /\b(?:envOr|has)\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g]) {
      let m;
      while ((m = re.exec(src)) !== null) read.add(m[1]);
    }
  }
  const unlisted = [...read].filter((k) => !lib.ALLOWED_KEYS.includes(k));
  const unread = lib.ALLOWED_KEYS.filter((k) => !read.has(k));
  check('every variable the scripts read is on the list', read.size > 0 && unlisted.length === 0, 'read but not listed: ' + unlisted.join(', '));
  check('every name on the list is read by a script', unread.length === 0, 'listed but never read: ' + unread.join(', '));
}
const HOSTILE = envLine('OPENAI_BASE_URL', 'https://attacker.invalid/v1') + envLine('HTTPS_PROXY', 'http://attacker.invalid:8080') + envLine('https_proxy', 'http://attacker.invalid:8080') + envLine('NODE_OPTIONS', '--require /tmp/evil.js') + envLine('GOOGLE_API_KEY', KEY.above) + envLine('PATH', '/attacker/bin');
{
  const l = layout('hostile-project');
  l.project(HOSTILE + envLine('OPENAI_API_KEY', KEY.project));
  l.machine(HOSTILE + envLine('GEMINI_API_KEY', KEY.machine));
  const env = {};
  lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('a base URL, proxy, NODE_OPTIONS, or other unknown name in either file is ignored', sameEnv(env, { OPENAI_API_KEY: KEY.project, GEMINI_API_KEY: KEY.machine }), JSON.stringify(env));
  const userSet = { OPENAI_BASE_URL: 'https://user-chose-this.invalid' };
  lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env: userSet });
  check('a real environment variable off the list is left exactly as the user set it', userSet.OPENAI_BASE_URL === 'https://user-chose-this.invalid' && userSet.OPENAI_API_KEY === KEY.project, JSON.stringify(userSet));
}
{
  // The same, through the real process.env of a child with no options.
  const l = layout('hostile-child');
  l.project(HOSTILE + envLine('OPENAI_API_KEY', KEY.project));
  l.machine(HOSTILE + envLine('FAL_KEY', KEY.machine));
  const r = childLoad(l.nested, l.home, {});
  const j = r.json;
  const changed = j ? Object.keys(j.after).filter((k) => j.before[k] !== j.after[k]).sort() : null;
  check('process.env: OPENAI_BASE_URL, HTTPS_PROXY, and NODE_OPTIONS from a file do not change it', r.status === 0 && j && j.after.OPENAI_BASE_URL === undefined && j.after.HTTPS_PROXY === undefined && j.after.https_proxy === undefined && j.after.NODE_OPTIONS === undefined && j.after.PATH === process.env.PATH, r.stdout + r.stderr);
  check('process.env: the only variables that change are the allowed ones the files set', JSON.stringify(changed) === JSON.stringify(['FAL_KEY', 'OPENAI_API_KEY']), JSON.stringify(changed));
}
{
  // Every allowed name loads, from the project file and from the machine file.
  const value = (k) => k === 'GEN_MEDIA_POLL_MS' ? '42' : 'value-for-' + k.toLowerCase().replace(/_/g, '-');
  const all = lib.ALLOWED_KEYS.map((k) => envLine(k, value(k))).join('');
  const lp = layout('all-project');
  lp.project(all);
  const envP = {};
  lib.loadEnvLocal({ cwd: lp.nested, homedir: lp.home, env: envP });
  const missingP = lib.ALLOWED_KEYS.filter((k) => envP[k] !== value(k));
  check('every allowed name loads from the project file', missingP.length === 0 && Object.keys(envP).length === lib.ALLOWED_KEYS.length, 'not loaded: ' + missingP.join(', '));
  const lm = layout('all-machine');
  lm.machine(all);
  const envM = {};
  lib.loadEnvLocal({ cwd: lm.nested, homedir: lm.home, env: envM });
  const missingM = lib.ALLOWED_KEYS.filter((k) => envM[k] !== value(k));
  check('every allowed name loads from the machine file', missingM.length === 0 && Object.keys(envM).length === lib.ALLOWED_KEYS.length, 'not loaded: ' + missingM.join(', '));
}

// --- 7. A whitespace-only value counts as unset -------------------------------------
console.log('\n7. whitespace-only values');
{
  const l = layout('whitespace');
  l.project(envLine('OPENAI_API_KEY', KEY.project) + envLine('GEMINI_API_KEY', KEY.project) + 'GPT_MODEL=" "\n');
  l.machine('GPT_MODEL=machine-model\n');
  const env = { OPENAI_API_KEY: ' ', GEMINI_API_KEY: '\t\r\n ', FAL_KEY: '  ' };
  lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env });
  check('a whitespace-only environment value falls back to the file', env.OPENAI_API_KEY === KEY.project && env.GEMINI_API_KEY === KEY.project, JSON.stringify(env));
  check('a whitespace-only value with no file value to replace it is left alone', env.FAL_KEY === '  ', JSON.stringify(env.FAL_KEY));
  check('a whitespace-only quoted value in the project file does not hide the machine file', env.GPT_MODEL === 'machine-model', JSON.stringify(env.GPT_MODEL));
  const padded = { OPENAI_API_KEY: ' ' + KEY.env + ' ' };
  lib.loadEnvLocal({ cwd: l.nested, homedir: l.home, env: padded });
  check('an environment value with real content and stray spaces is still set, and wins', padded.OPENAI_API_KEY === ' ' + KEY.env + ' ', JSON.stringify(padded.OPENAI_API_KEY));
}

// --- 8. An unreadable file is skipped with a warning --------------------------------
console.log('\n8. unreadable files');
{
  const l = layout('unreadable');
  const projectFile = l.project(envLine('OPENAI_API_KEY', KEY.project));
  const machineFile = l.machine(envLine('GEMINI_API_KEY', KEY.machine));
  fs.chmodSync(projectFile, 0o000);
  let readable = true;
  try { fs.readFileSync(projectFile); } catch (e) { readable = false; }
  if (readable) {
    // Root (and some filesystems) read a mode 000 file anyway, so there is nothing to test.
    console.log('  skip unreadable-file checks: a mode 000 file is still readable here (running as root?)');
  } else {
    const r = childLoad(l.nested, l.home, { OPENAI_API_KEY: KEY.env });
    const j = r.json;
    const lines = r.stderr.split('\n').filter(Boolean);
    check('an unreadable project .env.local does not crash when the key is in the environment', r.status === 0 && j && j.after.OPENAI_API_KEY === KEY.env, r.stdout + r.stderr);
    check('it warns in exactly one short stderr line that names the file', lines.length === 1 && lines[0].includes(projectFile) && lines[0].length < 300 && !/\n\s+at /.test(r.stderr), r.stderr);
    check('the machine file is still read after the skipped one', j && j.after.GEMINI_API_KEY === KEY.machine && j.res.project === projectFile && JSON.stringify(j.res.read) === JSON.stringify([machineFile]), r.stdout);
    check('no key value appears in the warning', !r.stderr.includes(KEY.env) && !r.stderr.includes(KEY.project) && !r.stderr.includes(KEY.machine), r.stderr);
  }
  fs.chmodSync(projectFile, 0o600);
}

for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach(f => console.log('  - ' + f));
process.exit(1);
