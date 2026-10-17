#!/usr/bin/env node
'use strict';
// push-guard.js - the push guard (issue #260). A Claude Code PreToolUse hook
// on Bash: Claude Code runs it before every Bash command Claude makes, so the
// M11 pre-push check runs before a push whether or not Claude remembered to
// run it ("a safeguard the agent can decline to invoke, or reconfigure, is
// not a safeguard"). Only the owner can let a flagged push through, by
// answering Claude Code's approval prompt.
//
// The reader, classify(command): command text in, a decision out. It makes
// no git call and runs no scan, so it is tested on text alone
// (scripts/test-push-guard.js) and replayed on every real command from this
// repo's saved sessions before it is switched on.
//
//   none  no push in the command, or a dry run. The guard says nothing, and
//         Claude Code's normal permission flow runs unchanged.
//   scan  a standard push. The hook runs the pre-push check for exactly that
//         destination first; push.askAlways marks --no-verify and force
//         pushes, which go to the owner even when the check is clean.
//   ask   a push the check cannot scan (a delete, --mirror, --all, --tags,
//         --follow-tags, --prune). The owner decides.
//   deny  a push in any other shape. Blocked, with the standard forms named.
//
// The guard never answers "allow": a hook's allow skips prompts the owner's
// settings or auto mode would show, so the guard can only add a prompt or a
// block, never remove one.
//
// A standard push, and why each part of it is required:
//   git push [-u|--set-upstream] [-q|-v|--porcelain|--progress] <remote> <refspec>
//   - <remote> is a remote's name, never a URL or a path: the check ranges
//     against the remote's tracking refs, which only a named remote has.
//   - <refspec> is HEAD:<branch> (or HEAD:refs/heads/<branch>), HEAD, a
//     branch name or a tag name. The check scans what HEAD adds, so the hook
//     confirms a branch or tag name is the checked-out commit.
//   - Every word of the push is plain (letters, digits and ._/:@-+=), so bash
//     runs exactly the words the guard read: nothing in them can expand.
//   - The push is the command's first part, or comes right after the M11 call
//     (node running a path that ends in pre-push-check.js), because a command
//     before it could change what is pushed after the check has run.
//   - Only an output filter may read its output through a pipe. A command
//     after ; && || or a newline runs once the push has finished, so it is not
//     limited, except that a second push is denied.
//
// Reading the text. The words come from tokenize in run-checks.js, the checks
// runner's hardened shell-word reader, loaded lazily so that a missing copy
// is the hook's error to handle. Three things are read first, none of which
// can hide a push:
//   - Claude Code's commit form, an option's value written as "$(cat <<'EOF'
//     ... EOF )", is read as plain text. The quoted delimiter means bash
//     expands nothing in the body and cat only prints it. It counts only when
//     the first line equal to the delimiter is followed directly by )", since
//     anything else there would run inside the $( ).
//   - A backslash-newline is removed, as bash removes it, so `git pu\` and
//     `sh` on the next line read as the push they are.
//   - $? and ${PIPESTATUS[N]} read as 0: they only ever expand to a number,
//     and Claude often ends a push with an echo of one.
// A command the tokenizer still refuses (here-documents, $( ), variables) is
// denied when one of its lines names git and then push (git stash push
// aside), and gets no answer otherwise. That check reads only what bash would
// run as shell commands, so three kinds of text are left out first:
//   - The body of a here-document fed to anything but a shell, eval or
//     source (cat > file, git commit -F -, python3 -): text or an inline
//     script. A body that is unquoted (<<EOF) keeps its lines holding $( or
//     a backtick, which bash still runs. A body that cat or tee writes to a
//     file which the same command then runs with a shell (bash run.sh,
//     ./run.sh) is read as commands after all; a data file (.md, .json and
//     the like) is never run.
//   - The inside of quotes: bash never runs single-quoted text, and runs
//     double-quoted text only through $( ) or a backtick. A quoted string a
//     shell's -c or eval receives as its script is kept, and so is a
//     double-quoted one holding $( or a backtick.
//   - Shell comments, so an apostrophe in one cannot open a quote.
// Openers and quotes are found by their spelling, a reading simpler than
// bash's; where the two differ, only a command written to hide a push gains.
//
// Out of reach, by the owner's bar ("hard to skip, not impossible"): a push
// inside a script file Claude writes and runs, writes through GitHub's web
// API, disguised spellings inside text the tokenizer refuses, a shell alias
// or a git alias set in config that stands for push, and a fake script named
// pre-push-check.js run right before a push.

const path = require('path');

// The characters a pushed word may hold. Nothing here expands in bash.
const PLAIN_WORD = /^[A-Za-z0-9._\/:@+=-]+$/;
// A remote's name. A colon, an @ or a leading dot means a URL or a path.
const REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._\/-]*$/;
// A word that sets a variable for the command after it (FOO=1 git push).
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Programs that run a script given with -c, and eval: the script is read too.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'su', 'runuser', 'script']);
// Programs that run the command after them; git under one is not a standard push.
const WRAPPERS = new Set(['env', 'command', 'exec', 'builtin', 'nohup', 'nice', 'ionice', 'timeout', 'time',
  'stdbuf', 'setsid', 'sudo', 'doas', 'xargs', 'find', 'parallel', 'watch', 'flock', 'unbuffer', 'chronic',
  'caffeinate', 'strace', 'ltrace', 'chroot', 'nsenter', 'unshare', 'systemd-run']);
// What may read a push's output through a pipe.
const OUTPUT_FILTERS = new Set(['tail', 'head', 'grep', 'egrep', 'fgrep', 'cat', 'wc']);
// git's own options that take the next word as their value.
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--super-prefix', '--config-env', '--attr-source']);
const LONG_FLAGS = new Set(['--set-upstream', '--quiet', '--verbose', '--porcelain', '--progress']);
const UNSCANNABLE = new Set(['--delete', '--mirror', '--all', '--branches', '--tags', '--follow-tags', '--prune']);
// How deep a script inside a script inside a script is read.
const MAX_DEPTH = 3;
// What a commit-form message reads as: a plain word, never a git subcommand.
const MESSAGE_WORD = 'message-text';

const STANDARD_FORMS = '`git push -u <remote> HEAD:<branch>`, or `git push <remote> <tag>` for a tag on the checked-out commit';
const UNREADABLE_HINT = 'If it is not a push, put the long text in a file and pass the file instead (for a commit message, `git commit -F <file>`).';

let tokenizeFn = null;
function tokenizer() {
  if (tokenizeFn === null) tokenizeFn = require(path.join(__dirname, 'run-checks.js')).tokenize;
  if (typeof tokenizeFn !== 'function') throw new Error('run-checks.js beside the guard exports no tokenize');
  return tokenizeFn;
}

function denyReason(why, hint) {
  return 'push-guard blocked this push before it ran: ' + why + '. The pre-push check runs only on a push in a standard form, so push again on its own, from the folder that holds the commit, as ' +
    STANDARD_FORMS + '; an output filter after a pipe is fine (`| tail -4`).' + (hint ? ' ' + hint : '') +
    ' If the owner wants this exact command anyway, they can run it themselves with ! at the prompt.';
}
function unscannableReason(what) {
  return 'push-guard: the pre-push check cannot scan this push, because ' + what + '. Approve it only if you meant to push it this way; this approval is your "push anyway".';
}
function none(code) { return { decision: 'none', code: code, reason: null, push: null }; }
function scan(code, push) { return { decision: 'scan', code: code, reason: null, push: push }; }
function ask(code, reason) { return { decision: 'ask', code: code, reason: reason, push: null }; }
function deny(code, why, hint) { return { decision: 'deny', code: code, reason: denyReason(why, hint), push: null }; }

function base(word) { return word.split('/').pop(); }

// The end of the first line from `from` on that equals the here-document's
// delimiter (after leading tabs, for <<-), or -1 when no line does.
function delimiterLineEnd(text, from, delimiter, dashed) {
  let pos = from;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);
    if ((dashed ? line.replace(/^\t+/, '') : line) === delimiter) return end;
    if (nl === -1) return -1;
    pos = nl + 1;
  }
}

// Claude Code's commit form, read as plain text (see the header).
function readMessageForms(text) {
  const opener = /(^|[\s;|&])(-m|--message|--body|--title|--notes)(\s+|=)"\$\(cat <<(-?)(['"])([A-Za-z_][A-Za-z0-9_]*)\5[ \t]*\n/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = opener.exec(text)) !== null) {
    const end = delimiterLineEnd(text, m.index + m[0].length, m[6], m[4] === '-');
    if (end === -1) continue;
    const close = /^\s*\)"/.exec(text.slice(end));
    if (!close) continue;
    out += text.slice(last, m.index) + m[1] + m[2] + m[3] + '"' + MESSAGE_WORD + '"';
    last = end + close[0].length;
    opener.lastIndex = last;
  }
  return out + text.slice(last);
}

// The three readings that come before the tokenizer (see the header).
function prepare(text) {
  return readMessageForms(text)
    .replace(/\\\n/g, '')
    .replace(/\$\?/g, '0')
    .replace(/\$\{PIPESTATUS\[[0-9]+\]\}/g, '0');
}

// A here-document opener: << (not a <<< here-string), an optional - that
// strips leading tabs, then the delimiter, quoted ('EOF', "EOF", \EOF) or bare.
const HEREDOC_OPENER = /(?<!<)<<(?!<)(-?)[ \t]*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\2|(\\?)([A-Za-z_][A-Za-z0-9_]*))/g;

// True when the command a here-document feeds runs its body as shell commands.
function feedsShell(prefix) {
  const piece = prefix.split(/;|&&|\|\||\||\(|\{|`/).pop();
  return piece.split(/\s+/).some(function (w) {
    const b = base(w);
    return SHELLS.has(b) || b === 'eval' || b === 'source' || b === '.';
  });
}

// The name of the file cat or tee writes a here-document's body to, or null.
function writtenFile(prefix) {
  const piece = prefix.split(/;|&&|\|\||\||\(|\{|`/).pop().trim();
  const words = piece.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let target = null;
  if (base(words[0]) === 'cat') {
    const redirect = /(?:^|\s)>>?\s*([^\s<>]+)/.exec(piece);
    if (redirect) target = redirect[1];
  } else if (base(words[0]) === 'tee') {
    target = words.slice(1).filter(function (w) { return !w.startsWith('-') && !w.startsWith('<'); }).pop() || null;
  }
  return target === null ? null : (base(target.replace(/^["']+|["']+$/g, '')) || null);
}

// Files that are read, never run: a later mention of one is not a run.
const DATA_FILE = /\.(md|markdown|txt|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|html?|css|xml|log|patch|diff)$/i;

// True when the text runs the named file with a shell: as a command
// (./run.sh, $D/run.sh, . run.sh) or as a shell's script (bash run.sh).
// A file run by node or python is an inline script, as python3 - is.
function runsLater(rest, file) {
  if (DATA_FILE.test(file)) return false;
  const f = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = '(?:^|[;&|\\n`]|\\$\\(|\\bthen\\b|\\bdo\\b)\\s*';
  const end = '(?=$|[\\s"\';&|)`])';
  return new RegExp(start + '(?:\\S*/)?' + f + end).test(rest) ||
    new RegExp(start + '\\.\\s+\\S*?' + f + end).test(rest) ||
    new RegExp('\\b(?:bash|sh|zsh|dash|ksh|ash|source)\\s+(?:-\\S+\\s+)*["\']?\\S*?' + f + end).test(rest);
}

// The text with the bodies of its data here-documents taken out (see the header).
function withoutDataBodies(text) {
  const lines = text.split('\n');
  const docs = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    const opener = new RegExp(HEREDOC_OPENER.source, 'g');
    let m;
    while ((m = opener.exec(line)) !== null) {
      const prefix = line.slice(0, m.index);
      const quoted = m[2] !== undefined || m[4] === '\\';
      const delimiter = m[3] !== undefined ? m[3] : m[5];
      const from = i;
      while (i < lines.length) {
        const body = lines[i++];
        if ((m[1] === '-' ? body.replace(/^\t+/, '') : body) === delimiter) break;
      }
      docs.push({ from: from, to: i - 1, quoted: quoted, shell: feedsShell(prefix), file: writtenFile(prefix) });
    }
  }
  const drop = new Set();
  for (const d of docs) {
    if (d.shell || (d.file && runsLater(lines.slice(d.to + 1).join('\n'), d.file))) continue;
    for (let k = d.from; k <= d.to; k++) {
      if (!d.quoted && k < d.to && /\$\(|`/.test(lines[k])) continue;
      drop.add(k);
    }
  }
  return lines.filter(function (line, k) { return !drop.has(k); }).join('\n');
}

// True when the quoted string that starts right after `before` is a script
// that a shell's -c (sh -c, bash -lc, sudo bash -c) or eval receives.
function receivesScript(before) {
  const tail = before.slice(-80);
  return /(?:^|[\s;&|(`])(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|ash|fish|su|runuser|script)(?:\s+-\S+)*\s+-[A-Za-z]*c[A-Za-z]*\s+$/.test(tail) ||
    /(?:^|[\s;&|(`])eval\s+$/.test(tail);
}

// The text with the inside of its quotes and its shell comments left out
// (see the header).
function withoutQuotedText(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(text[i - 1]))) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += (c === '"' && text[j] === '\\') ? 2 : 1;
      const inner = text.slice(i + 1, j);
      const keep = (c === '"' && /\$\(|`/.test(inner)) || receivesScript(out);
      out += keep ? c + inner + c : c + c;
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// The lines of a command the tokenizer refused that bash would run as commands.
function shellText(text) { return withoutQuotedText(withoutDataBodies(text)); }

// True when a line names git and then push as words, or git-push.
const GIT_WORD = /(?:^|[\s'"\/;|&(`])git(?=$|[\s'";|&)`])/;
const PUSH_WORD = /(?:^|[\s'";|&(`])push(?=$|[\s'";|&)`])/;
const GIT_PUSH_WORD = /(?:^|[\s'"\/;|&(`])git-push(?=$|[\s'";|&)`])/;
function namesGitPush(text) {
  return text.split('\n').some(function (line) {
    if (GIT_PUSH_WORD.test(line)) return true;
    const g = GIT_WORD.exec(line);
    if (g === null) return false;
    const rest = line.slice(g.index + g[0].length);
    const push = new RegExp(PUSH_WORD.source, 'g');
    let m;
    while ((m = push.exec(rest)) !== null) {
      // git stash push stores work locally; it is not a push to a remote.
      if (!/(?:^|\s)stash\s+$/.test(rest.slice(0, m.index + m[0].length - 'push'.length))) return true;
    }
    return false;
  });
}

// The M11 call that may come right before a push: node running the check.
function isCheckCall(words) {
  return words.length >= 2 && words[0] === 'node' && /(^|\/)pre-push-check\.js$/.test(words[1]) &&
    words.slice(2).every(function (w) { return PLAIN_WORD.test(w); });
}

function isOutputFilter(words) {
  if (!words || words.length === 0) return false;
  if (OUTPUT_FILTERS.has(words[0])) return true;
  return words[0] === 'sed' &&
    words.some(function (w) { return /^-[A-Za-z]*n[A-Za-z]*$/.test(w); }) &&
    !words.some(function (w) { return /^-[A-Za-z]*i/.test(w) || w.startsWith('--in-place'); });
}

// Who runs the git at words[g]: git itself, git from a path, a wrapper (or a
// variable prefix) that runs it, or nobody (echo git push is text).
function runnerOf(words, g) {
  if (g === 0) return words[0] === 'git' ? 'git' : 'path';
  if (ASSIGNMENT.test(words[0]) || WRAPPERS.has(base(words[0]))) return 'wrapper';
  return 'data';
}

// One segment: null when it does not push, { deny } when it pushes in a shape
// the guard refuses, { standard: true } when it may be a standard push.
function segmentPush(words, level) {
  for (let k = 0; k < words.length; k++) {
    const name = base(words[k]);
    let script = null;
    if (name === 'eval') script = words.slice(k + 1).join(' ');
    else if (SHELLS.has(name)) {
      for (let c = k + 1; c < words.length - 1; c++) {
        if (/^-[A-Za-z]*c[A-Za-z]*$/.test(words[c])) { script = words[c + 1]; break; }
      }
    }
    if (script === null) continue;
    const pushes = level >= MAX_DEPTH ? namesGitPush(shellText(script)) : classify(script, level + 1).decision !== 'none';
    if (pushes) return { deny: deny('shell', 'the push runs inside ' + name + ', where the guard cannot check it') };
  }
  let g = -1;
  for (let k = 0; k < words.length; k++) {
    const name = base(words[k]);
    if (name === 'git' || name === 'git-push') { g = k; break; }
  }
  if (g === -1) return null;
  const runner = runnerOf(words, g);
  if (runner === 'data') return null;
  if (base(words[g]) === 'git-push') return { deny: deny('git-path', 'it runs git-push directly instead of git push') };
  let k = g + 1;
  const options = [];
  while (k < words.length && words[k].startsWith('-')) {
    options.push(words[k]);
    if (GIT_OPTIONS_WITH_VALUE.has(words[k]) && k + 1 < words.length) { options.push(words[k + 1]); k += 2; } else k += 1;
  }
  if (words[k] !== 'push') {
    const definesAlias = options.some(function (o, i) {
      return (o === '-c' || o === '--config-env') && /^alias\./i.test(options[i + 1] || '');
    });
    return definesAlias ? { deny: deny('options', 'it defines a git alias with -c, which could stand for push') } : null;
  }
  if (runner === 'wrapper') return { deny: deny('wrapper', 'git runs under ' + words[0] + ', which the guard cannot see through') };
  if (runner === 'path') return { deny: deny('git-path', 'it runs git from a path (' + words[g] + ')') };
  if (options.length) return { deny: deny('options', 'git options come before push (' + options.join(' ') + ')') };
  return { standard: true };
}

// The words of a push at the front of its segment: git push ...
function standardPush(words) {
  const odd = words.find(function (w) { return !PLAIN_WORD.test(w); });
  if (odd !== undefined) return deny('plain', 'the word ' + JSON.stringify(odd) + ' holds characters the guard does not read as plain text');
  const seen = { dryRun: false, noVerify: false, force: false, unscannable: [] };
  const positional = [];
  for (const w of words.slice(2)) {
    if (w.startsWith('--')) {
      if (LONG_FLAGS.has(w)) continue;
      if (w === '--dry-run') { seen.dryRun = true; continue; }
      if (w === '--no-verify') { seen.noVerify = true; continue; }
      if (w === '--force' || w.split('=')[0] === '--force-with-lease' || w === '--force-if-includes') { seen.force = true; continue; }
      if (UNSCANNABLE.has(w)) { seen.unscannable.push(w); continue; }
      return deny('flag', 'it uses ' + w + ', which the guard does not check');
    }
    if (w.startsWith('-') && w.length > 1) {
      for (const c of w.slice(1)) {
        if (c === 'u' || c === 'q' || c === 'v') continue;
        if (c === 'n') { seen.dryRun = true; continue; }
        if (c === 'f') { seen.force = true; continue; }
        if (c === 'd') { seen.unscannable.push('-d'); continue; }
        return deny('flag', 'it uses -' + c + ', which the guard does not check');
      }
      continue;
    }
    positional.push(w);
  }
  if (seen.dryRun) return none('dry-run');
  const remote = positional[0];
  if (remote === undefined) return deny('no-destination', 'it names no remote and no destination, so what git would push depends on settings the check cannot see');
  if (!REMOTE_NAME.test(remote) || remote.includes('//') || remote.includes('..')) {
    return deny('remote', 'its remote ' + JSON.stringify(remote) + ' is not the name of a remote, and a URL or a path cannot be checked');
  }
  if (seen.unscannable.length) return ask('unscannable', unscannableReason('it uses ' + seen.unscannable.join(' ')));
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) return deny('no-destination', 'it names no destination, so what git would push depends on settings the check cannot see');
  if (refspecs.length > 1) return deny('refspec', 'it names more than one destination, and the check covers one at a time');
  let spec = refspecs[0];
  if (spec.startsWith('+')) { seen.force = true; spec = spec.slice(1); }
  if (spec.startsWith(':')) return ask('unscannable', unscannableReason('it deletes ' + spec.slice(1) + ' on ' + remote));
  const colon = spec.indexOf(':');
  const src = colon === -1 ? spec : spec.slice(0, colon);
  let dst = colon === -1 ? null : spec.slice(colon + 1);
  if (dst !== null) {
    if (src !== 'HEAD') return deny('refspec', 'it pushes ' + src + ' rather than the checked-out commit, and the check scans what HEAD adds');
    if (dst.startsWith('refs/heads/')) dst = dst.slice('refs/heads/'.length);
    if (dst === '' || dst.startsWith('refs/') || dst.startsWith('-') || dst.includes(':')) {
      return deny('refspec', 'its destination ' + JSON.stringify(spec) + ' is not a branch name');
    }
  } else if (src !== 'HEAD' && (src === '' || src.startsWith('refs/') || src.startsWith('-'))) {
    return deny('refspec', 'it pushes ' + JSON.stringify(src) + ', which is not a branch or tag name');
  }
  const push = { remote: remote, refspec: refspecs[0], src: src, dst: dst, askAlways: seen.noVerify || seen.force, noVerify: seen.noVerify, force: seen.force };
  if (seen.noVerify) return scan('no-verify', push);
  if (seen.force) return scan('force', push);
  return scan('standard', push);
}

// The reader: one Bash command's text, the decision for it (see the header).
function classify(command, depth) {
  if (typeof command !== 'string') throw new TypeError('classify takes the command text');
  const level = depth || 0;
  const text = prepare(command);
  const read = tokenizer()(text);
  if (read.error) {
    return namesGitPush(shellText(text))
      ? deny('unreadable', 'it could not be read (' + read.error.replace(/^refused: /, '') + ') and a line of it names git and then push', UNREADABLE_HINT)
      : none('not-a-push');
  }
  const segs = read.segments;
  const ops = read.operators;
  const found = [];
  for (let i = 0; i < segs.length; i++) {
    const hit = segmentPush(segs[i], level);
    if (hit) found.push(Object.assign({ index: i }, hit));
  }
  if (found.length === 0) return none('not-a-push');
  if (found.length > 1) return deny('two-pushes', 'it holds more than one push, and the check covers one destination at a time');
  if (found[0].deny) return found[0].deny;
  const p = found[0].index;
  if (p > 0 && !(p === 1 && isCheckCall(segs[0]) && (ops[0] === '&&' || ops[0] === ';' || ops[0] === '\n'))) {
    return deny('not-first', 'the push is not the first command in it, and a command before the push could change what it sends after the check has run');
  }
  for (let j = p; ops[j] === '|'; j++) {
    if (!isOutputFilter(segs[j + 1])) {
      return deny('pipe', 'its output goes through a pipe into ' + segs[j + 1][0] + ', which is not an output filter (tail, head, grep, cat, wc or sed -n)');
    }
  }
  if (read.meta[p].some(function (m) { return m.input; })) return deny('plain', 'it reads its input from a file');
  return standardPush(segs[p]);
}

module.exports = { classify: classify, namesGitPush: namesGitPush, prepare: prepare };
