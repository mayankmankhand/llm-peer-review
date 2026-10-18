#!/usr/bin/env node
'use strict';
//
// test-push-guard.js - assertions for .claude/scripts/push-guard.js, the push
// guard (issue #260): a Claude Code PreToolUse hook that runs the M11 pre-push
// check before any push Claude makes, so the check no longer depends on Claude
// remembering to run it.
//
// Maintainer-only: lives under scripts/, which never ships.
//
// The "reader" cases call classify() on command text alone: no git, no scan.
// They pin every rule of the plan's decision table (plans/PLAN-issue-260.md),
// the push shapes Claude really types (taken from this repo's session
// transcripts), the forms the prompt files prescribe (each also checked
// against its source file, so a prompt edit that changes a form fails here
// before it reaches a downstream cycle), spellings the tokenizer resolves,
// hostile shapes, and commands that only mention push.
//
// The "hook" cases run the guard the way Claude Code runs it: a separate node
// process with the PreToolUse JSON on stdin, against scratch repos whose
// origin is a local bare repo, so nothing leaves the machine. The planted key
// is assembled at runtime from fragments, so no real-shaped secret sits in
// this file (LESSONS).
//
// The guard is loaded inside a try, so a missing or broken guard fails each
// case by name instead of crashing the suite. Failure details stay on one
// line: the release gate shows only the last lines of a failing suite.
//
// Usage: node scripts/test-push-guard.js

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, '.claude', 'scripts', 'push-guard.js');
const PLUGIN_GUARD = path.join(ROOT, 'plugin', 'scripts', 'push-guard.js');

// Hermetic git, as in test-pre-push-check.js: no global or system config
// reaches a scratch repo, the guard's git calls, or the scan it runs.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

let passed = 0;
const failures = [];
function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim().slice(0, 240); }
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok    ' + name); return; }
  const d = detail === undefined ? '' : ' - ' + oneLine(detail);
  failures.push(name + d);
  console.log('  FAIL  ' + name + d);
}

let guard = null;
let loadError = null;
try { guard = require(GUARD); } catch (e) { loadError = e; }

function classifyOrError(command) {
  if (!guard) return { error: 'push-guard.js did not load: ' + (loadError && loadError.message) };
  try { return { result: guard.classify(command) }; } catch (e) { return { error: e.message }; }
}

// One reader case: the decision, the code that says why, and for a scan the
// destination the hook will hand to the scanner.
function reader(name, command, want) {
  const r = classifyOrError(command);
  if (r.error) { check('reader: ' + name, false, r.error); return; }
  const got = r.result || {};
  let ok = got.decision === want.decision && (want.code === undefined || got.code === want.code);
  if (ok && want.push) {
    for (const k of Object.keys(want.push)) if (!got.push || got.push[k] !== want.push[k]) ok = false;
  }
  check('reader: ' + name, ok,
    'got ' + JSON.stringify({ decision: got.decision, code: got.code, push: got.push }) + ', want ' + JSON.stringify(want));
}

const SCAN_FEATURE = { decision: 'scan', code: 'standard', push: { remote: 'origin', src: 'HEAD', dst: 'feature' } };

// Claude Code's own commit form: a quoted here-document fed to cat.
function commitForm(message) {
  return 'git commit -m "$(cat <<\'EOF\'\n' + message + '\nEOF\n)"';
}

console.log('\n1. standard pushes are scanned');
reader('the /document push form piped to tail is a standard push', 'git push -u origin HEAD:feature 2>&1 | tail -4', SCAN_FEATURE);
reader('a plain HEAD to branch push is standard', 'git push origin HEAD:main', { decision: 'scan', code: 'standard', push: { remote: 'origin', src: 'HEAD', dst: 'main' } });
reader('HEAD to refs/heads/<branch> is read as the branch', 'git push origin HEAD:refs/heads/feature', SCAN_FEATURE);
reader('a bare branch name is a standard push, resolved by the hook', 'git push origin main', { decision: 'scan', code: 'standard', push: { remote: 'origin', src: 'main', dst: null } });
reader('a tag name is a standard push, resolved by the hook', 'git push origin v1.2.0', { decision: 'scan', code: 'standard', push: { remote: 'origin', src: 'v1.2.0', dst: null } });
reader('HEAD alone is a standard push of the current branch', 'git push origin HEAD', { decision: 'scan', code: 'standard', push: { remote: 'origin', src: 'HEAD', dst: null } });
reader('quiet, verbose, porcelain and progress flags keep a push standard', 'git push -q --porcelain --progress -v origin HEAD:feature', SCAN_FEATURE);
reader('--set-upstream keeps a push standard', 'git push --set-upstream origin HEAD:feature', SCAN_FEATURE);
reader('output filters after the push keep it standard', 'git push origin HEAD:feature 2>&1 | grep -E "ok|FAIL" | tail -3', SCAN_FEATURE);
reader('sed -n after a pipe is an output filter', 'git push origin HEAD:feature 2>&1 | sed -n 1,3p', SCAN_FEATURE);
reader('a push followed by more commands is still standard', 'git push origin HEAD:feature 2>&1 | tail -2; git status --short', SCAN_FEATURE);
reader('an exit status echo with PIPESTATUS after the push is read', 'git push -u origin HEAD:feature 2>&1 | tail -4; echo "push exit=${PIPESTATUS[0]}"', SCAN_FEATURE);
reader('an exit status echo with $? after the push is read', 'git push origin HEAD:feature 2>&1 | tail -2; echo "exit $?"', SCAN_FEATURE);

console.log('\n2. the M11 check call may come right before the push');
reader('the M11 call from the repo copy joined by && keeps the push standard', 'node .claude/scripts/pre-push-check.js origin feature && git push -u origin HEAD:feature 2>&1 | tail -n 8', SCAN_FEATURE);
reader('the M11 call with the plugin root literal keeps the push standard', 'node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js origin feature && git push -u origin HEAD:feature', SCAN_FEATURE);
reader('the M11 call from an absolute plugin path joined by ; keeps the push standard', 'node /home/user/.claude/plugins/cache/llm-peer-review/tk/8.0.6/scripts/pre-push-check.js origin feature; git push origin HEAD:feature', SCAN_FEATURE);
reader('the M11 call from the stable path keeps the push standard', 'node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/pre-push-check.js origin feature && git push origin HEAD:feature', SCAN_FEATURE);
reader('the M11 call on the line before the push keeps it standard', 'node .claude/scripts/pre-push-check.js origin feature\ngit push origin HEAD:feature', SCAN_FEATURE);

console.log('\n3. spellings the tokenizer resolves are still read as a push');
reader('quotes and a backslash inside git push are still read as a push', "g''it pu\\sh origin HEAD:feature", SCAN_FEATURE);
reader('a quoted git is still read as git', '"git" push origin HEAD:feature', SCAN_FEATURE);
reader('a backslash-newline inside push is still read as a push', 'git pu\\\nsh origin HEAD:feature', SCAN_FEATURE);

console.log('\n4. the push forms the prompt files prescribe are standard pushes');
// Each form is checked in its source file first: when a prompt changes its
// wording, this check fails and the reader case below must change with it.
const PRESCRIBED = [
  { label: 'M11 (source)', file: '.claude/skills/shared/hitl-stages.md', check: 'node .claude/scripts/pre-push-check.js <remote> <ref>', push: 'git push <remote> HEAD:<branch>' },
  { label: 'M11 stable path', file: '.claude/skills/shared/hitl-stages.md', check: 'node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/pre-push-check.js <remote> <ref>', push: 'git push <remote> HEAD:<branch>' },
  { label: 'M11 (plugin)', file: 'plugin/skills/shared/hitl-stages.md', check: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js <remote> <ref>', push: 'git push <remote> HEAD:<branch>' },
  { label: '/document (source)', file: '.claude/commands/document.md', check: 'node .claude/scripts/pre-push-check.js <remote> <branch>', push: 'git push -u <remote> HEAD:<branch>' },
  { label: '/document (plugin)', file: 'plugin/commands/document.md', check: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js <remote> <branch>', push: 'git push -u <remote> HEAD:<branch>' },
  { label: '/merge (source)', file: '.claude/commands/merge.md', check: 'node .claude/scripts/pre-push-check.js origin <branch>', push: 'git push origin HEAD:<branch>' },
  { label: '/merge (plugin)', file: 'plugin/commands/merge.md', check: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js origin <branch>', push: 'git push origin HEAD:<branch>' },
];
function fill(form) { return form.split('<remote>').join('origin').split('<branch>').join('feature').split('<ref>').join('feature'); }
for (const p of PRESCRIBED) {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, p.file), 'utf8'); } catch (e) { text = ''; }
  check('prescribed: ' + p.file + ' still holds ' + p.check, text.includes(p.check));
  check('prescribed: ' + p.file + ' still holds ' + p.push, text.includes(p.push));
  reader('prescribed: the ' + p.label + ' push alone is a standard push', fill(p.push), SCAN_FEATURE);
  reader('prescribed: the ' + p.label + ' check then push is a standard push', fill(p.check) + ' && ' + fill(p.push), SCAN_FEATURE);
}

console.log('\n5. --no-verify and force pushes are scanned, then always asked');
reader('--no-verify is scanned and then always asked', 'git push --no-verify -u origin HEAD:feature', { decision: 'scan', code: 'no-verify', push: { askAlways: true, dst: 'feature' } });
reader('--force is scanned and then always asked', 'git push --force origin HEAD:feature', { decision: 'scan', code: 'force', push: { askAlways: true } });
reader('-f is a force push', 'git push -f origin HEAD:feature', { decision: 'scan', code: 'force' });
reader('a combined -uf is a force push', 'git push -uf origin HEAD:feature', { decision: 'scan', code: 'force' });
reader('--force-with-lease with a value is a force push', 'git push --force-with-lease=feature:abc1234 origin HEAD:feature', { decision: 'scan', code: 'force' });
reader('--force-if-includes is a force push', 'git push --force-with-lease --force-if-includes origin HEAD:feature', { decision: 'scan', code: 'force' });
reader('a + refspec is a force push', 'git push origin +HEAD:feature', { decision: 'scan', code: 'force', push: { dst: 'feature' } });

console.log('\n6. pushes the check cannot scan are asked');
reader('--delete cannot be scanned and is asked', 'git push origin --delete old-branch other-branch', { decision: 'ask', code: 'unscannable' });
reader('-d cannot be scanned and is asked', 'git push -d origin old-branch', { decision: 'ask', code: 'unscannable' });
reader('a :branch refspec deletes and is asked', 'git push origin :old-branch', { decision: 'ask', code: 'unscannable' });
for (const flag of ['--mirror', '--all', '--branches', '--tags', '--prune']) {
  reader(flag + ' cannot be scanned and is asked', 'git push ' + flag + ' origin', { decision: 'ask', code: 'unscannable' });
}
reader('--follow-tags cannot be scanned and is asked', 'git push --follow-tags origin HEAD:feature', { decision: 'ask', code: 'unscannable' });

console.log('\n7. a dry run pushes nothing');
reader('--dry-run pushes nothing and gets no answer', 'git push --dry-run origin HEAD:feature', { decision: 'none', code: 'dry-run' });
reader('-n pushes nothing and gets no answer', 'git push -n origin HEAD:feature', { decision: 'none', code: 'dry-run' });

console.log('\n8. every other push shape is denied');
reader('git -C before push is denied', 'git -C ../other push origin HEAD:feature', { decision: 'deny', code: 'options' });
reader('git -c before push is denied', 'git -c core.hooksPath=/dev/null push origin HEAD:feature', { decision: 'deny', code: 'options' });
reader('a git alias defined with -c is denied', 'git -c alias.p=push p origin HEAD:feature', { decision: 'deny', code: 'options' });
reader('cd before the push is denied', 'cd .claude/worktrees/a && git push origin HEAD:feature', { decision: 'deny', code: 'not-first' });
reader('a commit before the push in one command is denied', 'git commit -qm wip && git push origin HEAD:feature', { decision: 'deny', code: 'not-first' });
reader('a pipe into the push is denied', 'echo y | git push origin HEAD:feature', { decision: 'deny', code: 'not-first' });
reader('two pushes in one command are denied', 'git push origin HEAD:a; git push origin HEAD:b', { decision: 'deny', code: 'two-pushes' });
reader('a push inside bash -c is denied', "bash -c 'git push origin HEAD:feature'", { decision: 'deny', code: 'shell' });
reader('a push inside sh -c is denied', 'sh -c "git push origin HEAD:feature"', { decision: 'deny', code: 'shell' });
reader('a push inside eval is denied', 'eval git push origin HEAD:feature', { decision: 'deny', code: 'shell' });
reader('a push inside a wrapped shell is denied', "env FOO=1 sh -c 'git push origin HEAD:feature'", { decision: 'deny', code: 'shell' });
reader('an environment prefix is denied', 'FOO=1 git push origin HEAD:feature', { decision: 'deny', code: 'wrapper' });
reader('env before git push is denied', 'env FOO=1 git push origin HEAD:feature', { decision: 'deny', code: 'wrapper' });
reader('command git push is denied', 'command git push origin HEAD:feature', { decision: 'deny', code: 'wrapper' });
reader('xargs git push is denied', 'xargs git push origin < refs.txt', { decision: 'deny', code: 'wrapper' });
reader('timeout before git push is denied', 'timeout 60 git push origin HEAD:feature', { decision: 'deny', code: 'wrapper' });
reader('a path to git is denied', '/usr/bin/git push origin HEAD:feature', { decision: 'deny', code: 'git-path' });
reader('git-push run directly is denied', 'git-push origin HEAD:feature', { decision: 'deny', code: 'git-path' });
reader('a push with no remote is denied', 'git push', { decision: 'deny', code: 'no-destination' });
reader('a push with only a remote is denied', 'git push origin', { decision: 'deny', code: 'no-destination' });
reader('a push with only -u is denied', 'git push -u', { decision: 'deny', code: 'no-destination' });
reader('a URL as the remote is denied', 'git push https://github.com/example/repo.git HEAD:main', { decision: 'deny', code: 'remote' });
reader('an scp-style address as the remote is denied', 'git push git@github.com:example/repo.git HEAD:main', { decision: 'deny', code: 'remote' });
reader('a path as the remote is denied', 'git push ../other.git HEAD:main', { decision: 'deny', code: 'remote' });
reader('a ~ path as the remote is denied', 'git push ~/repo.git HEAD:main', { decision: 'deny', code: 'plain' });
reader('two refspecs are denied', 'git push origin HEAD:a HEAD:b', { decision: 'deny', code: 'refspec' });
reader('pushing another ref than HEAD to a branch is denied', 'git push origin topic:main', { decision: 'deny', code: 'refspec' });
reader('an unlisted flag is denied', 'git push --atomic origin HEAD:feature', { decision: 'deny', code: 'flag' });
reader('a push option is denied', 'git push -o ci.skip origin HEAD:feature', { decision: 'deny', code: 'flag' });
reader('piping the push into tee is denied', 'git push origin HEAD:feature | tee push.log', { decision: 'deny', code: 'pipe' });
reader('a brace expansion in the refspec is denied as unreadable', 'git push origin HEAD:{a,b}', { decision: 'deny', code: 'unreadable' });
reader('a background push is denied as unreadable', 'git push origin HEAD:feature &', { decision: 'deny', code: 'unreadable' });
reader('a variable in a push is denied as unreadable', 'git push origin HEAD:$BRANCH', { decision: 'deny', code: 'unreadable' });
reader('a here-document that ends early before a push is denied', 'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\ngit push origin HEAD:feature\n)"', { decision: 'deny', code: 'unreadable' });
reader('a here-document fed to bash is read as commands', "bash <<'EOF'\ngit push origin HEAD:feature\nEOF", { decision: 'deny', code: 'unreadable' });
reader('a here-document fed to sudo bash is read as commands', "sudo bash <<'EOF'\ngit push origin HEAD:feature\nEOF", { decision: 'deny', code: 'unreadable' });
reader('an unquoted here-document still counts its text', 'cat <<EOF\n$(git push origin HEAD:feature)\nEOF', { decision: 'deny', code: 'unreadable' });
reader('a push on the line of a here-document still counts', "git push origin HEAD:feature; cat > x.md <<'EOF'\nhi\nEOF", { decision: 'deny', code: 'unreadable' });
reader('a push after a here-document ends still counts', "cat > x.md <<'EOF'\nhi\nEOF\ngit push origin HEAD:feature", { decision: 'deny', code: 'unreadable' });
reader('a script written from a here-document and run by bash in the same command is read as commands', "cat > $D/run.sh <<'EOF'\ngit push origin HEAD:feature\nEOF\nbash $D/run.sh", { decision: 'deny', code: 'unreadable' });
reader('a script written from a here-document and run by its path is read as commands', "cat > ./run.sh <<'EOF'\ngit push origin HEAD:feature\nEOF\nchmod +x run.sh && ./run.sh", { decision: 'deny', code: 'unreadable' });
reader('a push inside bash -c still counts in an unreadable command', "bash -c 'git push origin HEAD:feature'; echo \"$X\"", { decision: 'deny', code: 'unreadable' });
reader('a push inside a double-quoted command substitution still counts', 'echo "$(git push origin HEAD:feature)"', { decision: 'deny', code: 'unreadable' });
reader('a push after a comment with an apostrophe still counts', "bash <<'EOF'\n# don't stop here\ngit push origin HEAD:feature\nEOF", { decision: 'deny', code: 'unreadable' });
reader('a push next to a quoted argument still counts', 'git push origin "HEAD:$B"', { decision: 'deny', code: 'unreadable' });

console.log('\n9. commands that only mention push get no answer');
reader('an ordinary command gets no answer', 'ls -la', { decision: 'none', code: 'not-a-push' });
reader('git status gets no answer', 'git status --short', { decision: 'none', code: 'not-a-push' });
reader('git log --grep push is not a push', 'git log --oneline --grep push', { decision: 'none', code: 'not-a-push' });
reader('a commit message that mentions git push is not a push', 'git commit -m "Block git push --no-verify"', { decision: 'none', code: 'not-a-push' });
reader("Claude Code's commit form that mentions git push is not a push", commitForm('Block git push --no-verify\n\nCo-Authored-By: Claude'), { decision: 'none', code: 'not-a-push' });
reader('a PR body in the same form is not a push', 'gh pr create --title "Guard" --body "$(cat <<\'EOF\'\nRun git push first\nEOF\n)"', { decision: 'none', code: 'not-a-push' });
reader('echo git push prints and does not push', 'echo git push origin HEAD:feature', { decision: 'none', code: 'not-a-push' });
reader('a node one-liner naming git push is not a push', 'node -e \'console.log("git push")\'', { decision: 'none', code: 'not-a-push' });
reader("adding the guard's own file is not a push", 'git add .claude/scripts/push-guard.js', { decision: 'none', code: 'not-a-push' });
reader('an unreadable command without push gets no answer', 'for f in a b; do echo $f; done', { decision: 'none', code: 'not-a-push' });
reader('an unreadable command that names push-guard is not a push', 'git add .claude/scripts/push-guard.js; echo "added $f"', { decision: 'none', code: 'not-a-push' });
reader('a file written from a quoted here-document that mentions git push is not a push', "cat > notes.md <<'EOF'\nRun git push origin HEAD:main first.\nEOF", { decision: 'none', code: 'not-a-push' });
reader('a JavaScript file written and run by node is a script, not shell commands', "cat > run.js <<'EOF'\nconst cmd = 'git push origin HEAD:main';\nEOF\nnode run.js", { decision: 'none', code: 'not-a-push' });
reader('a markdown file named later in a link is not run', "cat > notes.md <<'EOF'\nRun git push first.\nEOF\necho '- [Notes](notes.md)' >> index.md", { decision: 'none', code: 'not-a-push' });
reader('git stash push is not a push in an unreadable command', 'git stash push -m wip -- a.txt && echo "$X"', { decision: 'none', code: 'not-a-push' });
reader('a grep for git push is not a push in an unreadable command', 'grep -rn "git push" "$DIR"', { decision: 'none', code: 'not-a-push' });
reader('a commit message naming git push is not a push in an unreadable command', 'git commit -m "Block git push" && echo "$X"', { decision: 'none', code: 'not-a-push' });
reader('a file written from a here-document and only added to git is not a push', "cat > notes.md <<'EOF'\nRun git push first.\nEOF\ngit add notes.md", { decision: 'none', code: 'not-a-push' });
reader('a commit message read from a here-document is not a push', "git commit -q -F - <<'EOF'\nBlock git push --no-verify\nEOF", { decision: 'none', code: 'not-a-push' });
reader('an inline script from a here-document is not read as shell', "python3 - <<'EOF'\nprint(\"git push origin HEAD:main\")\nEOF", { decision: 'none', code: 'not-a-push' });
reader('a grep for the words git push is not a push', 'grep -rn "git push" docs/', { decision: 'none', code: 'not-a-push' });

// --- the hook ---------------------------------------------------------------

// One private folder holds every scratch repo and every scan's temp trees
// (TMPDIR, as in test-pre-push-check.js), and is removed at exit.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'push-guard-test-'));
process.on('exit', function () { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
function childEnv(extra) { return Object.assign({}, process.env, { TMPDIR: SCRATCH, TMP: SCRATCH, TEMP: SCRATCH }, extra || {}); }

// A fake GitLab token: the scan's gitlab-pat pattern matches it.
const FAKE_KEY = 'gl' + 'pat-' + 'A1b2C3d4E5f6G7h8J9k0';

let repoCount = 0;
function commitFile(sb, name, contents) {
  fs.mkdirSync(path.dirname(path.join(sb.repo, name)), { recursive: true });
  fs.writeFileSync(path.join(sb.repo, name), contents);
  sb.g(['add', name]);
  sb.g(['commit', '-qm', 'add ' + name]);
}
// A scratch repo on main whose first commit is already on its origin, a local
// bare repo, so a scan has a remote base as a real branch does.
function scratchRepo(label) {
  const root = path.join(SCRATCH, label + '-' + (++repoCount));
  const sb = { root: root, repo: path.join(root, 'repo'), bare: path.join(root, 'origin.git') };
  sb.g = function (args) { return execFileSync('git', args, { cwd: sb.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); };
  fs.mkdirSync(sb.repo, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', sb.bare], { stdio: ['ignore', 'pipe', 'ignore'] });
  sb.g(['init', '-q']);
  sb.g(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  sb.g(['config', 'user.email', 'test@example.com']);
  sb.g(['config', 'user.name', 'Test']);
  sb.g(['config', 'commit.gpgsign', 'false']);
  sb.g(['config', 'core.excludesFile', '/dev/null']);
  sb.g(['remote', 'add', 'origin', sb.bare]);
  commitFile(sb, 'README.md', 'seed\n');
  sb.g(['push', '-q', 'origin', 'main']);
  return sb;
}
// A folder holding a copy of the guard and the named files beside it.
function guardCopy(label, siblings) {
  const dir = path.join(SCRATCH, label);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['push-guard.js'].concat(siblings)) fs.copyFileSync(path.join(ROOT, '.claude', 'scripts', f), path.join(dir, f));
  return path.join(dir, 'push-guard.js');
}

// The PreToolUse input Claude Code sends for one Bash call.
function bashCall(command, cwd, mode) {
  return { session_id: 'test', transcript_path: '/dev/null', cwd: cwd, permission_mode: mode || 'default',
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: command, description: 'test' }, tool_use_id: 'toolu_test' };
}

// Every answer any hook run printed, for the never-allow case.
const answers = [];
// Runs a guard copy the way Claude Code runs the hook, from a folder of its
// own (`from`); `script` may be a function that makes the copy to run.
// Returns the exit status, the raw output, and the answer read
// from it: 'none' when it printed nothing. A setup error becomes the answer
// 'setup-failed', so the case still fails by name.
function runHook(makeInput, opts) {
  const o = opts || {};
  try {
    const input = makeInput();
    const script = typeof o.script === 'function' ? o.script() : (o.script || GUARD);
    const r = spawnSync(process.execPath, [script], {
      cwd: o.from || SCRATCH, input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8', env: o.env || childEnv(), timeout: 60000,
    });
    const got = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', decision: 'none', reason: '' };
    if (got.stdout.trim() !== '') {
      try {
        const h = JSON.parse(got.stdout).hookSpecificOutput || {};
        got.decision = h.hookEventName === 'PreToolUse' ? String(h.permissionDecision) : 'not-pretooluse';
        got.reason = String(h.permissionDecisionReason || '');
      } catch (e) { got.decision = 'not-json'; }
    }
    answers.push(got);
    return got;
  } catch (e) {
    return { status: null, stdout: '', stderr: e.message, decision: 'setup-failed', reason: '' };
  }
}
function show(got) { return 'exit ' + got.status + ', ' + got.decision + ': ' + (got.reason || got.stdout || got.stderr); }
// One hook case: exit 0, the answer wanted, and a phrase the reason holds.
function hook(name, got, want, phrase) {
  check('hook: ' + name, got.status === 0 && got.decision === want && (phrase === undefined || got.reason.indexOf(phrase) !== -1), show(got));
}
function setUp(fn) { try { return fn(); } catch (e) { check('hook: a scratch repo is set up', false, e.message); return null; } }

console.log('\n10. the hook, run the way Claude Code runs it');
const clean = setUp(function () { const sb = scratchRepo('clean'); commitFile(sb, 'src/app.js', 'console.log("ordinary code");\n'); return sb; });
const keyed = setUp(function () { const sb = scratchRepo('keyed'); commitFile(sb, 'ci/token.env', 'CI_TOKEN' + '=' + FAKE_KEY + '\n'); return sb; });

hook('a clean standard push gets no answer', runHook(function () { return bashCall('git push -u origin HEAD:feature 2>&1 | tail -4', clean.repo); }), 'none');
hook('HEAD alone is scanned as the checked-out branch', runHook(function () { return bashCall('git push origin HEAD', keyed.repo); }), 'deny', '[gitlab-pat]');
hook('a scan that cannot check is denied with its reason', runHook(function () {
  const sb = scratchRepo('both');
  sb.g(['branch', 'same']);
  sb.g(['tag', 'same']);
  return bashCall('git push origin same', sb.repo);
}), 'deny', 'names both a tag and a branch');
hook('--no-verify is asked about even when the check is clean', runHook(function () { return bashCall('git push --no-verify origin HEAD:feature', clean.repo); }), 'ask', '--no-verify');
hook('a force push is asked about even when the check is clean', runHook(function () { return bashCall('git push --force origin HEAD:feature', clean.repo); }), 'ask', 'force push');
const behind = setUp(function () {
  const sb = scratchRepo('behind');
  sb.g(['branch', 'older']);
  sb.g(['tag', 'v0']);
  commitFile(sb, 'src/next.js', 'console.log("next");\n');
  return sb;
});
hook('a branch that is not the checked-out commit is denied', runHook(function () { return bashCall('git push origin older', behind.repo); }), 'deny', 'branch older');
hook('a tag that is not the checked-out commit is denied', runHook(function () { return bashCall('git push origin v0', behind.repo); }), 'deny', 'tag v0');
hook('a mirror remote is asked about', runHook(function () {
  const sb = scratchRepo('mirror');
  sb.g(['config', 'remote.origin.mirror', 'true']);
  return bashCall('git push origin HEAD:feature', sb.repo);
}), 'ask', 'mirror');
hook('a remote whose push address differs from its fetch address is asked about', runHook(function () {
  const sb = scratchRepo('split');
  sb.g(['remote', 'set-url', '--push', 'origin', path.join(sb.root, 'elsewhere.git')]);
  return bashCall('git push origin HEAD:feature', sb.repo);
}), 'ask', 'push address');
const viaCwd = runHook(function () { return bashCall('git push origin HEAD:feature', keyed.repo); }, { from: clean ? clean.repo : SCRATCH });
hook("the scan runs in the input's cwd, not the hook's own folder", viaCwd, 'deny', '[gitlab-pat]');
hook('a flagged push is blocked with the way round named: the owner types it with !', viaCwd, 'deny', 'with ! at the prompt');
hook('a push the check cannot scan is asked about', runHook(function () { return bashCall('git push origin --delete old-branch', clean.repo); }), 'ask', 'cannot scan');
hook('a push in another shape is denied with the standard forms named', runHook(function () { return bashCall('git -C . push origin HEAD:feature', clean.repo); }), 'deny', 'HEAD:<branch>');
hook('unreadable input that mentions push is denied', runHook(function () { return '{not json: git push origin HEAD:feature'; }), 'deny');
hook('unreadable input without push gets no answer', runHook(function () { return '{not json'; }), 'none');
hook('another tool gets no answer', runHook(function () {
  return Object.assign(bashCall('', clean.repo), { tool_name: 'Read', tool_input: { file_path: '/notes/git-push.md' } });
}), 'none');
hook('a missing scanner denies pushes', runHook(function () { return bashCall('git push origin HEAD:feature', clean.repo); },
  { script: function () { return guardCopy('no-scanner', ['run-checks.js']); } }), 'deny', 'pre-push-check.js');
hook('a missing run-checks.js beside the guard denies pushes', runHook(function () { return bashCall('git push origin HEAD:feature', clean.repo); },
  { script: function () { return guardCopy('no-reader', ['pre-push-check.js']); } }), 'deny', 'run-checks.js');
hook('a missing run-checks.js beside the guard lets other commands through', runHook(function () { return bashCall('ls -la', clean.repo); },
  { script: path.join(SCRATCH, 'no-reader', 'push-guard.js') }), 'none');
hook('the built plugin copy blocks a planted-key push', runHook(function () { return bashCall('git push origin HEAD:feature', keyed.repo); },
  { script: PLUGIN_GUARD }), 'deny', '[gitlab-pat]');
hook('--no-verify in a repo with its own pre-push hook names that hook', runHook(function () {
  const sb = scratchRepo('own-hook');
  fs.writeFileSync(path.join(sb.repo, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return bashCall('git push --no-verify origin HEAD:feature', sb.repo);
}), 'ask', '.git/hooks/pre-push');
hook('a push that would ask is denied in bypassPermissions mode, since no prompt is sure to show', runHook(function () {
  return bashCall('git push --no-verify origin HEAD:feature', clean.repo, 'bypassPermissions');
}), 'deny', '--no-verify');
const marker = path.join(SCRATCH, 'git-ran');
const quiet = runHook(function () {
  const bin = path.join(SCRATCH, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\necho ran > "' + marker + '"\n', { mode: 0o755 });
  return bashCall('ls -la && git status --short', clean.repo);
}, { env: childEnv({ PATH: path.join(SCRATCH, 'fake-bin') }) });
check('hook: a command with no push gets no answer without running git', quiet.status === 0 && quiet.decision === 'none' && !fs.existsSync(marker),
  show(quiet) + (fs.existsSync(marker) ? ' (git ran)' : ''));
check('hook: no answer ever says allow', answers.length > 0 && answers.every(function (a) { return a.decision !== 'allow' && a.stdout.indexOf('"allow"') === -1; }),
  answers.filter(function (a) { return a.decision === 'allow'; }).map(show).join(' | '));
hook('a push carrying a planted key is blocked', runHook(function () {
  return bashCall('git push -u origin HEAD:feature 2>&1 | tail -4', keyed.repo);
}), 'deny', '[gitlab-pat]');

console.log('');
if (failures.length === 0) { console.log(passed + ' checks passed.'); process.exit(0); }
console.log(failures.length + ' FAILED, ' + passed + ' passed:');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
