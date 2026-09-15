#!/usr/bin/env node
'use strict';
// test-browse-spawn.js - assertions for how .claude/scripts/browse.js starts and
// stops a dev server under autoStart (issue #183). On native Windows npm is a
// .cmd shim that Node cannot launch without a shell, so the win32 spawn runs
// through the shell and the stop is a process-tree kill (taskkill /T /F); on
// Linux and macOS the spawn and the process-group kill stay exactly as they
// were. A spawn that cannot find its command now ends in the script's JSON
// error instead of an unhandled 'error' event and a stack trace.
//
// browse.js runs in a child process with TK_BROWSE_TEST_PLATFORM choosing the
// platform path, and a preload written by this suite that:
//   - stands in for playwright-core, so no browser (and no npm install) is needed;
//   - answers the port probes: nothing listens until the stubbed dev server
//     "starts", then port 3000 does, so a server already running on this
//     machine cannot change the path the script takes;
//   - records spawn, spawnSync and process.kill calls to a log file; the spawn
//     is faked unless a case asks for the real one, and no kill is ever sent;
//   - redirects the script's fixed /tmp/browse-server.pid into the sandbox.
// Dependency-free; exits non-zero on any failure.
//
//   node scripts/test-browse-spawn.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'browse.js');
const FAKE_PID = 4242424;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + String(detail).slice(0, 400) : '')); }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-spawn-'));
const home = path.join(sandbox, 'home');
fs.mkdirSync(home);
const emptyPath = path.join(sandbox, 'empty-path');
fs.mkdirSync(emptyPath);
const project = path.join(sandbox, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node server.js' } }, null, 2) + '\n');
const pidFile = path.join(sandbox, 'browse-server.pid');

const preload = path.join(sandbox, 'preload.js');
fs.writeFileSync(preload, [
  "'use strict';",
  "const fs = require('fs');",
  "const Module = require('module');",
  "const EventEmitter = require('events');",
  "const childProcess = require('child_process');",
  "const http = require('http');",
  'const LOG = process.env.BROWSE_STUB_LOG;',
  "const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + '\\n');",
  '',
  '// playwright-core: the browser never launches, so the run ends right after startup.',
  'const realLoad = Module._load;',
  'Module._load = function (request) {',
  "  if (request === 'playwright-core') {",
  "    return { chromium: { launch: async () => { throw new Error('stub browser: not launched in this test'); } } };",
  '  }',
  '  return realLoad.apply(this, arguments);',
  '};',
  '',
  '// Port probes: refused until the fake dev server starts, then port 3000 answers.',
  'let serverUp = false;',
  'http.request = function (opts, onResponse) {',
  '  const req = new EventEmitter();',
  '  req.end = () => setImmediate(() => {',
  "    if (serverUp && opts.port === 3000) onResponse({});",
  "    else req.emit('error', new Error('stub: connection refused'));",
  '  });',
  '  req.destroy = () => {};',
  '  return req;',
  '};',
  '',
  '// spawn is recorded; it is faked unless BROWSE_STUB_SPAWN is real.',
  'const realSpawn = childProcess.spawn;',
  'childProcess.spawn = function (command, args, options) {',
  "  log({ call: 'spawn', command, args, options });",
  "  if (process.env.BROWSE_STUB_SPAWN === 'real') return realSpawn.apply(this, arguments);",
  '  const child = new EventEmitter();',
  '  child.pid = ' + FAKE_PID + ';',
  '  child.unref = () => {};',
  '  serverUp = true;',
  '  return child;',
  '};',
  '',
  '// Kills are recorded and never sent.',
  'childProcess.spawnSync = function (command, args) {',
  "  log({ call: 'spawnSync', command, args });",
  "  return { pid: 0, status: 0, signal: null, output: [], stdout: null, stderr: null };",
  '};',
  'process.kill = function (pid, signal) {',
  "  log({ call: 'kill', pid, signal: signal === undefined ? null : signal });",
  '  return true;',
  '};',
  '',
  '// The fixed PID file path moves into the sandbox.',
  "const mapPid = (p) => (p === '/tmp/browse-server.pid' ? process.env.BROWSE_STUB_PID_FILE : p);",
  "for (const name of ['writeFileSync', 'existsSync', 'unlinkSync']) {",
  '  const real = fs[name];',
  '  fs[name] = function (p, ...rest) { return real.call(this, mapPid(p), ...rest); };',
  '}',
  '',
].join('\n'));

let runs = 0;
function runBrowse(opts) {
  const logFile = path.join(sandbox, 'calls-' + (++runs) + '.jsonl');
  fs.writeFileSync(logFile, '');
  try { fs.unlinkSync(pidFile); } catch (e) { /* not there */ }
  const env = Object.assign({}, process.env, {
    HOME: home,
    USERPROFILE: home,
    BROWSE_STUB_LOG: logFile,
    BROWSE_STUB_PID_FILE: pidFile,
    BROWSE_STUB_SPAWN: opts.spawn,
    TK_BROWSE_TEST_PLATFORM: opts.platform,
  });
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  if (opts.path !== undefined) env.PATH = opts.path;
  const input = JSON.stringify({ autoStart: true, projectDir: project, actions: [{ type: 'goto', url: '/' }] });
  const started = Date.now();
  // The node binary is named by its full path, so an emptied PATH still runs it.
  const r = spawnSync(process.execPath, ['--require', preload, SCRIPT], { cwd: project, env, input, encoding: 'utf8', timeout: 25000 });
  const calls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json, calls, ms: Date.now() - started };
}
const spawns = (run) => run.calls.filter((c) => c.call === 'spawn');
const kills = (run) => run.calls.filter((c) => c.call === 'kill');
const taskkills = (run) => run.calls.filter((c) => c.call === 'spawnSync' && c.command === 'taskkill');
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- 1. win32: the dev server starts through a shell, and stops as a tree ---------
console.log('\n1. win32');
{
  const run = runBrowse({ platform: 'win32', spawn: 'fake' });
  const s = spawns(run);
  const o = (s[0] || {}).options || {};
  check('win32: the dev server is spawned once', s.length === 1, JSON.stringify(run.calls) + run.stderr.slice(0, 300));
  check('win32: the spawn options include shell: true', o.shell === true, JSON.stringify(s[0]));
  check('win32: it still runs the project\'s dev script from the project folder with stdio ignored', /^npm run dev$/.test([s[0] && s[0].command].concat((s[0] && s[0].args) || []).join(' ')) && o.cwd === project && o.stdio === 'ignore', JSON.stringify(s[0]));
  check('win32: the server is stopped with taskkill /pid <pid> /T /F', taskkills(run).length >= 1 && sameJson(taskkills(run)[0].args, ['/pid', String(FAKE_PID), '/T', '/F']), JSON.stringify(run.calls));
  check('win32: no POSIX process-group kill is sent', !kills(run).some((k) => k.pid < 0), JSON.stringify(kills(run)));
  check('win32: the run still ends in the script\'s JSON (the stubbed browser fails to launch)', run.json !== null && run.json.ok === false, run.stdout.slice(0, 300));
}

// --- 2. linux: unchanged from before --------------------------------------------
console.log('\n2. linux');
{
  const run = runBrowse({ platform: 'linux', spawn: 'fake' });
  const s = spawns(run);
  check('linux: the dev server is spawned once', s.length === 1, JSON.stringify(run.calls) + run.stderr.slice(0, 300));
  check('linux: command and arguments are unchanged: npm [run, dev]', s[0] && s[0].command === 'npm' && sameJson(s[0].args, ['run', 'dev']), JSON.stringify(s[0]));
  check('linux: the spawn options are exactly the old ones (cwd, stdio ignore, detached)', s[0] && sameJson(s[0].options, { cwd: project, stdio: 'ignore', detached: true }), JSON.stringify(s[0] && s[0].options));
  check('linux: the server is stopped with a SIGTERM to its process group', kills(run).some((k) => k.pid === -FAKE_PID && k.signal === 'SIGTERM'), JSON.stringify(kills(run)));
  check('linux: taskkill is never used', taskkills(run).length === 0, JSON.stringify(run.calls));
  check('linux: the run ends in the script\'s JSON', run.json !== null && run.json.ok === false, run.stdout.slice(0, 300));
}

// --- 3. A spawn that cannot find its command -------------------------------------
console.log('\n3. a missing command');
{
  // The real spawn, with PATH emptied so npm cannot be found.
  const run = runBrowse({ platform: 'linux', spawn: 'real', path: emptyPath });
  const err = (run.json && run.json.error) || '';
  check('the script prints its JSON error, ok false', run.json !== null && run.json.ok === false, 'stdout: ' + run.stdout.slice(0, 300) + ' stderr: ' + run.stderr.slice(0, 300));
  check('the error says auto-start failed and why (spawn npm ENOENT)', /^Server auto-start failed: /.test(err) && /npm/.test(err) && /ENOENT/.test(err), err);
  check('it exits 1', run.status === 1, 'exit ' + run.status);
  check('no unhandled error event and no stack trace on stderr', !/Unhandled 'error' event|throw er;|^\s+at /m.test(run.stderr), run.stderr.slice(0, 400));
  check('it fails at once rather than waiting out the 30s start timeout', run.ms < 15000, run.ms + 'ms');
  check('no PID file is left behind for a process that never started', !fs.existsSync(pidFile), fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : '');
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
