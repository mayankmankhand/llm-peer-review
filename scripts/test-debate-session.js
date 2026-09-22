#!/usr/bin/env node
'use strict';
// test-debate-session.js - assertions for the `session` subcommand of
// .claude/scripts/ask-gpt.js and ask-gemini.js (issue #181). /tk:ask-gpt and
// /tk:ask-gemini minted each debate's session id with
// `echo "$(date +%s)-$RANDOM"`, a command substitution that default permission
// mode stops to ask about; the scripts now print the id themselves. For both
// scripts: the id has the <digits>-<digits> shape warnIfSessionMismatch()
// reads (unix seconds, then 1 to 32767), the run exits 0 with nothing on
// stderr, and it needs no key. Both keys are unset, HOME is an empty folder (so
// there is no ~/.claude/plugins/.env.local), and a preload records that no
// .env.local is looked up and no SDK is loaded, even with a project .env.local
// planted in the working directory. A control run of `review` shows the
// preload does see that lookup when it happens. No key exists anywhere in
// these runs, so nothing can reach a model API. Dependency-free; exits
// non-zero on any failure.
//
//   node scripts/test-debate-session.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = path.resolve(__dirname, '..', '.claude', 'scripts');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')); }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'debate-session-'));
const home = path.join(sandbox, 'home');
fs.mkdirSync(home);
// The project: a .git marker ends the .env.local search here, and the planted
// .env.local is one the lookup would find at once. It names models, never a key.
const project = path.join(sandbox, 'project');
fs.mkdirSync(path.join(project, '.git'), { recursive: true });
fs.writeFileSync(path.join(project, '.env.local'), 'GPT_MODEL=probe-model\nGEMINI_MODEL=probe-model\n');
fs.writeFileSync(path.join(project, 'context.md'), 'something to review\n');

// The preload notes every stat, read or existence check of a file named
// .env.local, and every load of either SDK, one line each in PROBE_LOG.
const probeLog = path.join(sandbox, 'probe.log');
const probe = path.join(sandbox, 'probe.js');
fs.writeFileSync(probe, [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  "const Module = require('module');",
  "const note = (line) => fs.appendFileSync(process.env.PROBE_LOG, line + '\\n');",
  "for (const name of ['statSync', 'readFileSync', 'existsSync']) {",
  '  const real = fs[name];',
  '  fs[name] = function (p, ...rest) {',
  "    if (typeof p === 'string' && path.basename(p) === '.env.local') note('envfile ' + name + ' ' + p);",
  '    return real.call(this, p, ...rest);',
  '  };',
  '}',
  'const realLoad = Module._load;',
  'Module._load = function (request) {',
  "  if (request === 'openai' || request === '@google/genai') note('sdk ' + request);",
  '  return realLoad.apply(this, arguments);',
  '};',
  // The Node floor guard (issue #197) reads process.version. The property is
  // read-only, so a plain assignment silently changes nothing and a test written
  // that way would pass at the real version for the wrong reason; defineProperty
  // is the one way to stub it.
  'if (process.env.FAKE_NODE_VERSION) {',
  "  Object.defineProperty(process, 'version', { value: process.env.FAKE_NODE_VERSION, configurable: true });",
  '}',
  '',
].join('\n'));

const TOOLKIT_VARS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GPT_MODEL', 'GPT_MAX_TOKENS', 'GEMINI_MODEL', 'GEMINI_MAX_TOKENS', 'GEMINI_USE_CONCAT_PROMPT'];
function runScript(file, args, extraEnv) {
  fs.writeFileSync(probeLog, '');
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, PROBE_LOG: probeLog }, extraEnv || {});
  for (const k of TOOLKIT_VARS) delete env[k];
  const r = spawnSync(process.execPath, ['--require', probe, path.join(SCRIPTS, file), ...args], {
    cwd: project, env, encoding: 'utf8', timeout: 20000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', probe: fs.readFileSync(probeLog, 'utf8') };
}

for (const file of ['ask-gpt.js', 'ask-gemini.js']) {
  console.log('\n' + file + ' session');
  const before = Math.floor(Date.now() / 1000);
  const r = runScript(file, ['session']);
  const after = Math.floor(Date.now() / 1000);
  const id = r.stdout.replace(/\n$/, '');
  const m = /^(\d+)-(\d+)$/.exec(id);
  check(file + ': exits 0 with no key anywhere', r.status === 0, 'exit ' + r.status + ': ' + r.stderr.slice(0, 300));
  check(file + ': stdout is one line shaped <digits>-<digits>', m !== null && r.stdout.endsWith('\n'), JSON.stringify(r.stdout));
  check(file + ': the first part is the current unix time in seconds', m !== null && Number(m[1]) >= before && Number(m[1]) <= after, id + ' vs ' + before + '..' + after);
  check(file + ': the second part is between 1 and 32767', m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 32767, id);
  check(file + ': nothing on stderr (no model line, no missing-key error)', r.stderr === '', r.stderr.slice(0, 300));
  check(file + ': no .env.local is looked up', !/^envfile /m.test(r.probe), r.probe);
  check(file + ': no SDK is loaded', !/^sdk /m.test(r.probe), r.probe);

  const extra = runScript(file, ['session', 'now']);
  check(file + ': session takes no options: an extra argument exits 1 with nothing on stdout', extra.status === 1 && extra.stdout === '' && /Unknown argument: now/.test(extra.stderr), extra.stdout + extra.stderr);

  // Control: a debate command does run the lookup, so the probe above would
  // have seen one. It stops at the missing key, before any request is built.
  const control = runScript(file, ['review', '--context-file', path.join(project, 'context.md')]);
  check(file + ': control: review looks up the planted .env.local, then stops at the missing key', control.status === 1 && /^envfile /m.test(control.probe) && /_API_KEY not found/.test(control.stderr) && !/^sdk /m.test(control.probe), control.stderr.slice(0, 300) + ' | ' + control.probe);
}

// Node floor guard (issue #197). Each script enforces its own package's floor:
// openai 7.17.0 wants Node 22, @google/genai 2.23.0 wants Node 20. The guard sits
// above `session`, so `session` drives it with no key and no SDK, and the message
// is the first line on stderr with nothing on stdout.
const FLOORS = { 'ask-gpt.js': { floor: 22, pkg: 'openai' }, 'ask-gemini.js': { floor: 20, pkg: '@google/genai' } };
// The floors are hand-copied from the lockfile, in the scripts and again here.
// Both packages are caret-ranged, so a future `npm update` can raise an engines
// floor and leave the guard stale (review of the #195/#197/#201 cycle, R6):
// read what the lockfile declares and hold the script's number to it.
const lock = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'package-lock.json'), 'utf8'));
for (const file of Object.keys(FLOORS)) {
  console.log('\n' + file + ' Node floor');
  const { floor, pkg } = FLOORS[file];
  const engines = ((lock.packages || {})['node_modules/' + pkg] || {}).engines || {};
  const declared = /^>=(\d+)\./.exec(engines.node || '');
  check(file + ': the lockfile declares a Node floor for ' + pkg, declared !== null, JSON.stringify(engines));
  check(file + ': NODE_FLOOR in the script equals the lockfile floor for ' + pkg, declared !== null && Number(declared[1]) === floor && new RegExp('^const NODE_FLOOR = ' + floor + ';$', 'm').test(fs.readFileSync(path.join(SCRIPTS, file), 'utf8')), 'lockfile says ' + (declared && declared[1]) + ', test says ' + floor);
  const line = new RegExp('^' + file.replace('.', '\\.') + ' needs Node\\.js ' + floor + ' or newer \\(the ' + pkg + ' package requires it\\); you have v18\\.20\\.0\\.$', 'm');
  const v18 = runScript(file, ['session'], { FAKE_NODE_VERSION: 'v18.20.0' });
  check(file + ': Node 18 exits 1 with the one-line floor message on stderr', v18.status === 1 && line.test(v18.stderr), 'exit ' + v18.status + ': ' + v18.stderr.slice(0, 300));
  check(file + ': Node 18 prints nothing on stdout and loads no SDK', v18.stdout === '' && !/^sdk /m.test(v18.probe), JSON.stringify(v18.stdout) + ' | ' + v18.probe);
  const v20 = runScript(file, ['session'], { FAKE_NODE_VERSION: 'v20.19.0' });
  if (floor > 20) {
    check(file + ': Node 20 exits 1 naming ' + pkg, v20.status === 1 && v20.stdout === '' && new RegExp('needs Node\\.js ' + floor + ' .*' + pkg + '.*v20\\.19\\.0').test(v20.stderr), 'exit ' + v20.status + ': ' + v20.stderr.slice(0, 300));
  } else {
    check(file + ': Node 20 is at the floor, so session still exits 0 with a session id', v20.status === 0 && /^\d+-\d+\n$/.test(v20.stdout) && v20.stderr === '', 'exit ' + v20.status + ': ' + v20.stdout + v20.stderr.slice(0, 300));
  }
  const at = runScript(file, ['session'], { FAKE_NODE_VERSION: 'v' + floor + '.0.0' });
  check(file + ': exactly the floor passes', at.status === 0 && at.stderr === '', 'exit ' + at.status + ': ' + at.stderr.slice(0, 300));
  // The stub itself: a probe that failed to change process.version would make
  // every check above pass at the real version for the wrong reason.
  const echo = spawnSync(process.execPath, ['--require', probe, '-e', 'process.stdout.write(process.version)'], {
    env: Object.assign({}, process.env, { PROBE_LOG: probeLog, FAKE_NODE_VERSION: 'v1.2.3' }), encoding: 'utf8',
  });
  check(file + ': the preload really replaces process.version', echo.stdout === 'v1.2.3', JSON.stringify(echo.stdout));
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
