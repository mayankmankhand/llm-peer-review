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
  '',
].join('\n'));

const TOOLKIT_VARS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GPT_MODEL', 'GPT_MAX_TOKENS', 'GEMINI_MODEL', 'GEMINI_MAX_TOKENS', 'GEMINI_USE_CONCAT_PROMPT'];
function runScript(file, args) {
  fs.writeFileSync(probeLog, '');
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, PROBE_LOG: probeLog });
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

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
