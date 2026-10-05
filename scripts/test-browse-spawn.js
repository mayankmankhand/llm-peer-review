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
//   - redirects the script's /tmp/browse-server.pid into the sandbox, and logs
//     where the PID file was written (issue #194).
// Section 5 swaps the failing browser for a fake one (BROWSE_STUB_BROWSER=fake)
// to drive the `value` action (issue #204): the fake page remembers what `fill`
// typed, and reports an input's innerText as empty, exactly as a real browser does.
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
  '// With BROWSE_STUB_BROWSER=fake it launches the fake browser below instead.',
  'const realLoad = Module._load;',
  'Module._load = function (request) {',
  "  if (request === 'playwright-core') {",
  "    if (process.env.BROWSE_STUB_BROWSER === 'fake') return { chromium: { launch: async () => fakeBrowser() } };",
  "    return { chromium: { launch: async () => { throw new Error('stub browser: not launched in this test'); } } };",
  '  }',
  '  return realLoad.apply(this, arguments);',
  '};',
  '',
  '// The fake browser: a field holds what fill typed; its innerText is empty, as in a',
  '// real browser; a selector named #missing never appears, so reading it times out;',
  '// one named #not-a-field is found but is not a form field, so reading it fails at once.',
  'function fakeBrowser() {',
  '  const values = {};',
  '  const locator = (sel) => ({',
  '    fill: async (v) => { values[sel] = v; },',
  "    innerText: async () => '',",
  '    inputValue: async () => {',
  "      if (sel === '#missing') { const e = new Error('stub: locator.inputValue: Timeout exceeded'); e.name = 'TimeoutError'; throw e; }",
  "      if (sel === '#not-a-field') throw new Error('stub: locator.inputValue: Node is not an <input>, <textarea> or <select> element');",
  "      return values[sel] === undefined ? '' : values[sel];",
  '    },',
  '  });',
  "  const page = { on: () => {}, goto: async () => ({ status: () => 200 }), waitForTimeout: async () => {}, title: async () => 'stub page', locator };",
  '  return { newContext: async () => ({ newPage: async () => page }), close: async () => {} };',
  '}',
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
  '  fs[name] = function (p, ...rest) {',
  "    if (name === 'writeFileSync' && /browse-server\\.pid$/.test(String(p))) log({ call: 'pidWrite', path: String(p) });",
  '    return real.call(this, mapPid(p), ...rest);',
  '  };',
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
  if (opts.tmp !== undefined) { env.TMPDIR = opts.tmp; env.TMP = opts.tmp; env.TEMP = opts.tmp; }
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

// --- 4. Temp folder: os.tmpdir() on native Windows only (issue #194) --------------
// On native Windows '/tmp' is \tmp on the current drive, so the PID file and
// screenshots use the user's temp folder there. Every other platform keeps /tmp
// even when TMPDIR points elsewhere (macOS sets it under /var/folders), because
// the toolkit grants read access to /tmp only.
console.log('\n4. temp folder');
{
  const winTmp = path.join(sandbox, 'win-temp');
  fs.mkdirSync(winTmp);
  const win = runBrowse({ platform: 'win32', spawn: 'fake', tmp: winTmp });
  const winWrites = win.calls.filter((c) => c.call === 'pidWrite');
  check('win32: the PID file is written under os.tmpdir()', winWrites.length === 1 && winWrites[0].path === path.join(winTmp, 'browse-server.pid'), JSON.stringify(winWrites));
  const lin = runBrowse({ platform: 'linux', spawn: 'fake', tmp: winTmp });
  const linWrites = lin.calls.filter((c) => c.call === 'pidWrite');
  check('linux: the PID file stays at /tmp even when TMPDIR is set elsewhere', linWrites.length === 1 && linWrites[0].path === '/tmp/browse-server.pid', JSON.stringify(linWrites));
  const src = fs.readFileSync(SCRIPT, 'utf8');
  check('screenshots use the same temp folder rule as the PID file', /screenshotDir: tempDir\(\),/.test(src) && /serverPidFile: path\.join\(tempDir\(\), 'browse-server\.pid'\),/.test(src), 'CONFIG in browse.js');
}

// --- 5. value: read what was typed into a field (issue #204) -----------------------
// `text` reads innerText, which is always empty for an input, so a draft that a
// re-render threw away looked the same as one that survived. `value` reads the
// field's live value, which is what the design loop's interaction pass checks.
console.log('\n5. value');
function runActions(actions, extraArgs) {
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, BROWSE_STUB_BROWSER: 'fake', BROWSE_STUB_LOG: path.join(sandbox, 'actions.jsonl'), BROWSE_STUB_PID_FILE: pidFile });
  const input = JSON.stringify({ baseUrl: 'http://127.0.0.1:9', actions });
  const r = spawnSync(process.execPath, ['--require', preload, SCRIPT].concat(extraArgs || []), { cwd: project, env, input, encoding: 'utf8', timeout: 25000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}
{
  const run = runActions([
    { type: 'goto', url: '/' },
    { type: 'fill', target: 'css:#f', value: 'probe draft' },
    { type: 'text', target: 'css:#f' },
    { type: 'value', target: 'css:#f' },
  ]);
  const acts = (run.json && run.json.actions) || [];
  check('value: a session that uses it is accepted and runs to the end', run.json !== null && run.json.ok === true && acts.length === 4, run.stdout.slice(0, 400) + run.stderr.slice(0, 200));
  check('value: text reads the filled input as empty, which is why value exists', acts[2] && acts[2].type === 'text' && acts[2].text === '', JSON.stringify(acts[2]));
  check('value: it returns what was typed, with its target', acts[3] && sameJson(acts[3], { type: 'value', ok: true, target: 'css:#f', value: 'probe draft' }), JSON.stringify(acts[3]));

  const noTarget = runActions([{ type: 'goto', url: '/' }, { type: 'value' }]);
  const nt = ((noTarget.json && noTarget.json.actions) || [])[1] || {};
  check('value: a missing target is the script\'s field error, not a crash', noTarget.json !== null && noTarget.json.ok === false && nt.error === 'Action "value" requires a "target" field.', noTarget.stdout.slice(0, 400));

  const missing = runActions([{ type: 'goto', url: '/' }, { type: 'value', target: 'css:#missing' }]);
  const mi = ((missing.json && missing.json.actions) || [])[1] || {};
  check('value: a field that never appears times out with the script\'s message', missing.json !== null && mi.ok === false && /^value on "css:#missing" timed out after \d+ms/.test(mi.error || ''), JSON.stringify(mi));

  const notField = runActions([{ type: 'goto', url: '/' }, { type: 'value', target: 'css:#not-a-field' }]);
  const nf = ((notField.json && notField.json.actions) || [])[1] || {};
  check('value: an element that is not a form field fails at once with the underlying reason, not as a timeout', notField.json !== null && nf.ok === false && /^Could not read a value from "css:#not-a-field": stub: locator\.inputValue: Node is not an <input>/.test(nf.error || ''), JSON.stringify(nf));

  const help = runActions([], ['--help']);
  check('value: --help lists the action and its field', /\n  value +Read the current value of a form field\n +Fields: target/.test(help.stdout), help.stdout.slice(0, 200));
}

// --- 6. --actions: the JSON as one argument, for a caller with no Write tool -------
// A dispatched browser finder has Bash but no Write tool, so it cannot make the
// actions file the stdin form needs, and an inline echo breaks at the first
// apostrophe. `--actions '<json>'` takes the same JSON as one argument, parsed
// exactly like stdin, and its help tells the caller to keep apostrophes out of
// the argument: the 7.6.0 headless probe found that Claude Code's command check
// refuses a quote closed and reopened mid-argument, and that the model types a
// JSON escape for the apostrophe back as the apostrophe itself.
console.log('\n6. --actions');
function runArgs(extraArgs, stdinText) {
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, BROWSE_STUB_BROWSER: 'fake', BROWSE_STUB_LOG: path.join(sandbox, 'args.jsonl'), BROWSE_STUB_PID_FILE: pidFile });
  const r = spawnSync(process.execPath, ['--require', preload, SCRIPT].concat(extraArgs), { cwd: project, env, input: stdinText || '', encoding: 'utf8', timeout: 25000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}
{
  // The apostrophe is written the way a single-quoted shell argument has to carry it.
  const argJson = '{"baseUrl":"http://127.0.0.1:9","actions":[{"type":"goto","url":"/"},{"type":"fill","target":"css:#f","value":"don\\u0027t"},{"type":"value","target":"css:#f"}]}';
  const run = runArgs(['--actions', argJson]);
  const acts = (run.json && run.json.actions) || [];
  check('--actions: the JSON argument is accepted with nothing on stdin and runs to the end', run.json !== null && run.json.ok === true && acts.length === 3, run.stdout.slice(0, 400) + run.stderr.slice(0, 200));
  check('--actions: the argument goes through the same JSON parser as stdin (a \\u0027 escape reaches the field as an apostrophe)', acts[2] && acts[2].value === "don't", JSON.stringify(acts[2]));

  const stdinJson = JSON.stringify({ baseUrl: 'http://127.0.0.1:9', actions: [{ type: 'goto', url: '/' }] });
  const both = runArgs(['--actions', argJson], stdinJson);
  check('--actions: the argument wins when stdin also carries JSON', both.json !== null && both.json.ok === true && ((both.json.actions || []).length === 3), both.stdout.slice(0, 300));

  const bare = runArgs(['--actions']);
  check('--actions: the flag with no value is the script\'s own error, exit 1, no stack trace', bare.status === 1 && /--actions needs the JSON as its value/.test(bare.stderr) && !/^\s+at /m.test(bare.stderr), 'exit ' + bare.status + ' ' + bare.stderr.slice(0, 300));

  const help = runArgs(['--help']);
  check('--actions: --help names the argument and says the JSON sits in one pair of single quotes with no apostrophe inside', /--actions '<json>'/.test(help.stdout) && /one pair of single quotes/.test(help.stdout) && /keep\s+every apostrophe out of it/.test(help.stdout), help.stdout.slice(0, 900));
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.\n'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
