#!/usr/bin/env node
'use strict';
//
// quality-check.js - measure how well the toolkit's review catches known bugs,
// headless, so a prompt or model change can be judged on what it catches and
// not only on whether it still runs (issue #205, plan Step 1).
//
// Maintainer-only: lives under scripts/, which never ships downstream.
//
// Why: #206 cut and reworded about 60 prompt commits and every check passed,
// but every check asked "does it still work", never "does it still catch what
// it caught". A model swap (#205) is the change most able to lose a catch
// quietly: a missed bug is invisible to the audit, which only judges findings
// that were raised (LESSONS: a missing finding is invisible to the audit).
//
// What a run is. One headless Claude Code session, under a scratch home, that
// runs one toolkit command on a scratch project and is copied out before the
// scratch folders are removed:
//
//   --role review  The fixture in scripts/fixtures/quality-check/ becomes a
//                  two-commit git repo (base, then a change that plants one bug
//                  per review lens plus a known-answer case), its dev server is
//                  started on 127.0.0.1 port 3000 (the fixture's loopback.js keeps
//                  it off the network), and the session runs
//                  `/tk:review <all eight lenses> <base>..HEAD report only, no chaining`.
//   --role mapper  A git archive of a frozen source commit, and one dispatch of
//                  the index-mapper agent on a frozen chunk of it, with /index's
//                  Step 3 prompt template copied out of the build under test.
//
// The arm decides the measured agents' model and effort, patched into the
// build's agent files before the session starts (never into the repo):
//
//   a     the session model (Opus) at the role's current effort; the mapper at
//         medium, because its shipped low is the setting under suspicion
//   b     the session model one effort level lower (the mapper at low)
//   c     Sonnet at the decided effort, given with --effort
//   ship  no patch: the agent files as the build ships them (plan Step 7)
//
// Model modes (#205, plan Step 7). A build with the per-cycle switch resolves a
// mode for every review: its mode: word (--mode-word), else the Models line of
// the scratch copy of plans/PLAN-fixture.md (--plan-models), else fit. A run
// expects each finder on the model its mode names, read from the build's agent
// files as they stand after the arm's patch, the way session-init.js reads them:
// best is the session model, cheap is Sonnet, fit is the file's own model (inherit,
// or no line, is the session model). A ship run, or one given either flag, also
// expects the session to say "Models: <mode>" and, on a review, where the mode
// came from. A build without the switch passes no model, so each finder answers
// on its file's model, which is fit's expectation: the older arms are unchanged.
//
// Session settings, the same for every run: --model opus, --effort high (the
// orchestrator's effort is pinned, so only the arm's agents vary), the
// subagent-model variables removed from the environment, bypassPermissions (the
// check measures what the review catches, not which calls would prompt; the
// owner approves those interactively in real use, and a run whose receipts were
// refused would score the refusal), no MCP servers, the page-publishing tools
// removed, and a PATH shim that turns the Windows browser launchers into no-ops,
// so a run neither publishes a page nor opens a window. Each run has a dollar cap
// (--max-usd), and the whole measurement has one approved budget (see Budget).
//
// Usage:
//   node scripts/quality-check.js --role review --arm <a|b|c|ship> --build <git-ref|tree>
//        [--effort <level>] [--max-usd <n>] [--label <text>] [--mode-word <best|fit|cheap>]
//        [--plan-models <best|fit|cheap>] [--keep]
//   node scripts/quality-check.js --role mapper --arm <a|b|c|ship> --build <git-ref|tree>
//        --chunk <manifest.json> [--effort <level>] [--max-usd <n>] [--keep]
//   node scripts/quality-check.js --score <run[,run...]> [--score <run[,run...]>]
//        --against <run[,run...]> [--require-known] [--json]
//   node scripts/quality-check.js --check <run-dir>        re-analyze one saved run
//   node scripts/quality-check.js --probe <browser|audit|models|review> --build <git-ref|tree>
//   node scripts/quality-check.js --probe <mode-probe> --build <git-ref|tree> [--mode-word <m>]
//        the model-mode checks of plan Step 7, one short session each, on the fixture:
//        index-mode         /tk:index [mode:<m>]: the mapper answers on the mode's model
//        review-code-mode   /tk:review-code [mode:<m>] on four changed files: its
//                           fan-out finders answer on the mode's model
//        execute-mismatch   /tk:execute on a Sonnet session of a one-step plan whose
//                           Models line is fit: it prints the build-model note
//        create-plan-cheap  /tk:create-plan from a fixed summary naming cheap: the
//                           plan carries **Models:** cheap and the close gives the
//                           fresh-session steps (/model opus), not "go"
//   node scripts/quality-check.js --budget                 the ledger against the approval
//   node scripts/quality-check.js --approve <usd>          record the owner's approved total
//
// Each run lands in reports/quality-check/<stamp>-<role>-<arm>-<build>/: run.json
// (what ran), result.json (the session's own JSON result), transcripts/ (every
// session and helper transcript), project-reports/ (the review's markdown
// report and receipts), analysis.json (validity and catches), and a line in
// reports/quality-check/ledger.jsonl. reports/ is gitignored and kept on disk.
//
// A run is INVALID, and is rerun once, when: the session did not end cleanly
// (non-zero exit, an error result, a turn or budget stop), it hit a usage limit,
// any session or helper answered on a model other than the one it should have,
// any call was denied, a review lens was not dispatched, a finder or the mapper
// returned nothing, the review wrote no report, the mapper dispatch did not carry
// the expected prompt, or a tool read outside the scratch project, the scratch
// home (which holds the plugin build and the stable plugin path) and /tmp. A
// second invalid run, or a usage limit, pages the owner (M1).
//
// Scoring (--score). A planted bug is CAUGHT in a review run when it survives the
// audit into the report; RAISED counts any finder's raw JSONL line that matched,
// shown beside so an audit kill is visible. For the mapper, the catches are the
// chunk's files it covered: opened with Read (or its plugin/.claude twin was) and
// described in a block whose Purpose is not "purpose unclear".
//   - A STABLE catch is one every valid baseline run caught; a bug only some
//     baseline runs caught is NOISY and not scored.
//   - A stable catch fails the candidate when two of its valid runs miss it.
//     One miss among two or more runs is noise (the other run is its rerun);
//     one miss in a single run is RERUN: run the candidate once more.
//   - Contract breaks (a finder attempt that is neither JSONL nor NO FINDINGS)
//     follow the same rule, counted per run.
//   - --require-known (finder arms b and c): the known-answer case must be a
//     stable baseline catch, or the verdict is PAGE, because the bar the plan
//     set for those arms cannot be applied.
//   - With several --score sets, the cheapest passing set is named.
//
// Budget. reports/quality-check/budget.json holds the owner's approved total.
// With no approval on record, only the first measured run may start (its cost
// sizes the request). With one, a run refuses to start when the money already
// spent plus the most any earlier run of its role cost would pass the approval,
// and prints the page for the owner. --approve records a new total; run it only
// after the owner says yes. A run that ends without a reported cost (a timeout, a
// crash, an interrupt) is entered at its cap and marked costCapped, so the spend
// total never comes out low.
//
// Each session runs in a process group of its own, as the fixture server does. At
// the 90-minute timeout the runner stops the whole group (the wrapper shell and the
// session under it), and Ctrl-C stops both groups before the runner leaves.
//
// Exit codes: 0 done (a valid run, or a score); 2 usage error; 3 the run was
// invalid; 4 the budget refused the run; 5 a probe or a mode check failed; 6 the owner's real
// config changed during the run (checked before and after every session; lines another of the
// owner's sessions added to the correction files do not count, APPEND_ONLY below); 7 the
// owner's login token could expire during the run (tokenWindowProblem, below); 130
// interrupted (a session already under way is still entered in the ledger).

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO, 'scripts', 'fixtures', 'quality-check');
const ANSWERS_FILE = path.join(FIXTURE, 'answers.json');
const LOOPBACK_PRELOAD = path.join(FIXTURE, 'loopback.js');
const HARNESS = path.join(REPO, 'scripts', 'setup', 'headless-session.sh');
const OUT_ROOT = path.join(REPO, 'reports', 'quality-check');
const LEDGER = path.join(OUT_ROOT, 'ledger.jsonl');
const BUDGET = path.join(OUT_ROOT, 'budget.json');
const REAL_HOME = os.homedir();
const NODE_MODULES = path.join(REPO, '.claude', 'scripts', 'node_modules');

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODES = ['best', 'fit', 'cheap'];
const FINDER_KINDS = ['code', 'security', 'ux', 'plan', 'commands', 'browser', 'deps', 'copy'];
const SESSION_MODEL = 'opus';
const SESSION_EFFORT = 'high';
const PORT = 3000;
const SESSION_TIMEOUT_MS = 90 * 60 * 1000;
// A stopped group gets SIGTERM, then SIGKILL for whatever is still running this long after.
const KILL_GRACE_MS = 10 * 1000;
const DEFAULT_MAX_USD = { review: 25, mapper: 8, probe: 5 };
// The two mode probes that run a whole command flow (a fan-out and its audit; an
// /index, a plan and its critic) get a larger cap than a one-call probe.
const PROBE_MAX_USD = { 'review-code-mode': 10, 'create-plan-cheap': 10 };

// Added to every session's system prompt. The last sentence is the #206 lesson:
// in an unattended run, one denied call made the model skip a later, different call.
const SYSTEM_NOTE = 'This is an unattended test session: no human is present, and nobody will answer a question. '
  + 'Run the requested command exactly as its instructions say. Where a step would stop to ask or page a human, '
  + 'put that question in your final message and end the run there. Judge each tool call on its own: skip a step '
  + 'only when that step\'s own call fails, never because an earlier, different call did.';

const LIMIT_RE = /usage limit|rate limit|limit reached|hit your (usage |weekly |session )?limit|weekly limit|5-hour limit|out of (extra )?usage|credit balance is too low/i;
const DENIED_RE = /permission to use|was denied|has been denied|requires approval|blocked by (a |the )?(hook|permission|policy)|not allowed to/i;

// ---------------------------------------------------------------------------
// Pure helpers (exported for scripts/test-quality-check.js)
// ---------------------------------------------------------------------------

// The model family of a model id ("claude-opus-5-5" -> "opus"), or null.
function familyOf(id) {
  const m = /(opus|sonnet|haiku|fable)/i.exec(String(id || ''));
  return m ? m[1].toLowerCase() : null;
}

// One effort level down, never below low.
function lowerEffort(level) {
  const i = EFFORTS.indexOf(level);
  if (i === -1) throw new Error('unknown effort level ' + level);
  return EFFORTS[Math.max(0, i - 1)];
}

// The agent file's frontmatter value for `key`, or null.
function frontmatterValue(text, key) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const m = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(fm[1]);
  return m ? m[1].trim() : null;
}

// The family a helper the mode moves should answer on, from its agent file's text
// as the build holds it (after any arm patch), resolved the way session-init.js
// resolves it: best is the session family, cheap is Sonnet, fit is the file's own
// model, where inherit, no model line or a value that is not an alias is the
// session family.
function modeFamily(mode, agentText, sessionFamily) {
  if (mode === 'best') return sessionFamily;
  if (mode === 'cheap') return 'sonnet';
  const value = String(frontmatterValue(agentText, 'model') || '').toLowerCase();
  return ['sonnet', 'opus', 'haiku', 'fable'].includes(value) ? value : sessionFamily;
}

// The first "Models: <mode>" a session wrote, checked against want: { mode, from },
// where from, when set, is a pattern for where the mode came from (the plan's
// name, the mode: word, or the default) that the same line, else the same text
// block, must also carry. `first` says whether it was the session's first text.
const MODE_RE = /\bModels\b\W{0,6}(best|fit|cheap)\b/i;
function modeLineCheck(texts, want) {
  for (let i = 0; i < texts.length; i++) {
    const line = texts[i].split('\n').find(l => MODE_RE.test(l));
    if (!line) continue;
    const got = MODE_RE.exec(line)[1].toLowerCase();
    const from = want.from ? new RegExp(want.from, 'i') : null;
    // Markup is not wording: "from the `mode:` word" says where the mode came from.
    const plain = t => t.replace(/[`*_]/g, '');
    const fromOk = !from || from.test(plain(line)) || from.test(plain(texts[i]));
    let detail = line.trim().slice(0, 200);
    if (got !== want.mode) detail += ' (want ' + want.mode + ')';
    else if (!fromOk) detail += ' (does not say where the mode came from: ' + want.from + ')';
    return { name: 'mode line', ok: got === want.mode && fromOk, found: true, first: i === 0, where: 'chat', detail };
  }
  return { name: 'mode line', ok: false, found: false, first: false, detail: 'no "Models: <mode>" line in the session\'s text' };
}

// session-init.js's Models line, which /create-plan writes under the progress line.
const MODELS_LINE = /^\*\*Models:\*\*[ \t]+([A-Za-z]+)[ \t]*\r?$/m;

// The checks a run's expect asks for beyond validity, each { name, ok, detail }:
// the mode line (modeLine), text the session must write somewhere (texts) or in
// its final answer (lastText), and the Models line in the header of a plan it
// wrote (planLine: { mode, skip: plans that were there before }).
function expectChecks(expect, main, run) {
  const checks = [];
  if (expect.modeLine) {
    let c = modeLineCheck(main.texts, expect.modeLine);
    // A review opens its report with the scope line that carries the mode
    // (review.md). The chat copy of that line was skipped in 4 of 10 measured runs
    // before modes existed, so a session that named no mode in its text counts when
    // its report opens with the right one; a wrong mode in the text still fails.
    if (!c.found && run.report) {
      const r = modeLineCheck([run.report.split('\n').slice(0, 12).join('\n')], expect.modeLine);
      if (r.found) c = { ...r, first: false, where: 'report', detail: r.detail + ' (in the report\'s opening, not the chat)' };
    }
    checks.push(c);
  }
  for (const t of expect.texts || []) {
    const re = new RegExp(t, 'i');
    const hit = main.texts.find(x => re.test(x));
    checks.push({ name: 'says /' + t + '/', ok: !!hit, detail: hit ? hit.split('\n').find(l => re.test(l)).trim().slice(0, 200) : 'not in the session\'s text' });
  }
  const final = run.result && typeof run.result.result === 'string' ? run.result.result : main.lastText;
  for (const t of expect.lastText || []) {
    const ok = new RegExp(t, 'i').test(final || '');
    checks.push({ name: 'closes with /' + t + '/', ok, detail: ok ? 'in the final answer' : 'not in the final answer: ' + String(final || '').slice(-200) });
  }
  if (expect.planLine) {
    const want = expect.planLine;
    const fresh = Object.entries(run.plans || {}).filter(([name]) => !(want.skip || []).includes(name));
    const named = fresh.map(([name, text]) => {
      const header = text.split(/\n## /)[0];
      const m = MODELS_LINE.exec(header);
      return { name, mode: m ? m[1].toLowerCase() : null };
    });
    const hit = named.find(p => p.mode === want.mode);
    checks.push({ name: 'plan Models line', ok: !!hit,
      detail: hit ? hit.name + ': **Models:** ' + hit.mode : fresh.length === 0 ? 'no new plan was written' : named.map(p => p.name + (p.mode ? ' names ' + p.mode : ' has no Models line in its header')).join('; ') });
  }
  return checks;
}

// Sets `model:` and `effort:` in an agent file's frontmatter: a line that exists
// is replaced in place, a missing one goes right after `tools:` (else at the end
// of the frontmatter). A value of null leaves that key as it was.
function patchAgent(text, set) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) throw new Error('agent file has no frontmatter');
  let lines = fm[1].split(/\r?\n/);
  for (const key of ['model', 'effort']) {
    const value = set[key];
    if (value === null || value === undefined) continue;
    const at = lines.findIndex(l => new RegExp('^' + key + ':').test(l));
    if (at !== -1) { lines[at] = key + ': ' + value; continue; }
    const tools = lines.findIndex(l => /^tools:/.test(l));
    // model goes before effort, so a file that gains both reads model, effort.
    const effortAt = lines.findIndex(l => /^effort:/.test(l));
    const insertAt = key === 'model' && effortAt !== -1 ? effortAt : (tools !== -1 ? tools + 1 : lines.length);
    lines.splice(insertAt, 0, key + ': ' + value);
  }
  return '---\n' + lines.join('\n') + '\n---' + text.slice(fm[0].length);
}

// A finder's returned text, read as the dispatch contract defines it: the single
// line NO FINDINGS, or JSONL. One surrounding code fence is tolerated; any other
// line that is not a JSON object with `severity` and `what` is a contract break.
function parseFinderOutput(text) {
  let body = String(text || '').trim();
  if (body === '') return { empty: true, noFindings: false, findings: [], broken: [] };
  const fence = /^```[a-z]*\r?\n([\s\S]*?)\r?\n```$/i.exec(body);
  if (fence) body = fence[1].trim();
  if (body === 'NO FINDINGS') return { empty: false, noFindings: true, findings: [], broken: [] };
  const findings = [];
  const broken = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') continue;
    let o = null;
    try { o = JSON.parse(t); } catch (e) { o = null; }
    if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.severity === 'string' && typeof o.what === 'string') findings.push(o);
    else broken.push(t.slice(0, 200));
  }
  return { empty: false, noFindings: false, findings, broken };
}

// A JSONL finding's sentences: what, context, fix and the key built from them.
// They carry no code names (finding-contract.md), so a bug is recognized in them
// by its consequence in plain words. The receipt and the attachments are never
// matched: a receipt that prints a block of code quotes whatever sits nearby, so
// even a precise pattern turns up in a neighbouring finding's evidence.
function findingText(f) {
  return [f.what, f.context, f.fix, f.key].filter(p => typeof p === 'string').join(' \n ');
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

// True when finding `f` ({file, line, text}) catches `bug` per the answer key's rule.
function bugMatches(bug, f) {
  // A browser finding may name the page's URL instead of a file: that is no file.
  const file = f.file && !/^(https?:\/\/|localhost[:/])/i.test(String(f.file).trim()) ? normPath(f.file) : '';
  let fileOk;
  if (file === '') fileOk = bug.fileless === true;
  else fileOk = bug.files.some(b => file === b || file.endsWith('/' + b));
  if (!fileOk) return false;
  if (bug.lineMatch && file !== '' && Number.isInteger(f.line)) {
    for (const [wf, start, end] of bug.lines || []) {
      if ((file === wf || file.endsWith('/' + wf)) && f.line >= start - 1 && f.line <= end + 1) return true;
    }
  }
  const text = String(f.text || '');
  return (bug.match || []).some(all => all.every(re => new RegExp(re, 'i').test(text)));
}

// A raw JSONL finding as the matcher's {file, line, text}.
function rawToMatchable(f) {
  const file = f.file && typeof f.file === 'object' ? (f.file.relPath || f.file.absPath || '') : (typeof f.file === 'string' ? f.file : '');
  let line = f.file && typeof f.file === 'object' && Number.isInteger(f.file.line) ? f.file.line : null;
  let rel = file;
  const colon = /^(.*?):(\d+)$/.exec(file);
  if (colon) { rel = colon[1]; line = line === null ? Number(colon[2]) : line; }
  return { file: rel, line, text: findingText(f) };
}

// The review's markdown report, split into the findings that survived the audit
// and the ones it killed (the "Audited out" section). Only three kinds of line
// speak for a finding: its own entry line (`- **R3** ...`, or a compact `R3 ⚠️ ...`
// line), the sub-bullets under that entry, and its segment of a Top Issues line
// (`🚫 2 Blocks: R1 [code] (...), R2 (...)`). Everything else that names an
// R-number is a cross-reference and adds nothing: a refuted finding's reason
// ("while R1 stands"), the Staff Check prose, the Verdict and the Digest. The
// Receipt row and the attachments (Expected, Actual, Screenshot, Evidence) are kept
// apart as the entry's evidence, and a skeptic's split line as its split: they
// quote code and output that name other findings' subjects, and are never matched.
function parseReport(md) {
  const lines = String(md || '').split(/\r?\n/);
  const survivors = new Map();
  const killed = new Map();
  const refRe = /`?([A-Za-z0-9_.\/-]*[A-Za-z0-9_-]\.[A-Za-z0-9]+)(?::(\d+))?`?/g;
  const entryOf = (map, id) => {
    if (!map.has(id)) map.set(id, { id, refs: [], text: '', evidence: '', split: '' });
    return map.get(id);
  };
  const add = (map, id, text) => {
    const e = entryOf(map, id);
    e.text += ' \n ' + text;
    let m;
    refRe.lastIndex = 0;
    while ((m = refRe.exec(text)) !== null) {
      if (/^\d+(\.\d+)*$/.test(m[1])) continue;
      e.refs.push({ file: normPath(m[1]), line: m[2] ? Number(m[2]) : null });
    }
  };
  const entryRe = /^(\s*)[-*]\s+\*\*R(\d+)\*\*/;
  const compactRe = /^(\s*)(?:[-*]\s+)?R(\d+)\s+(?:🚫|⚠️|💡|\[)/u;
  const topRe = /^\s*(?:```)?\s*\S{0,4}\s*\d+\s+(?:Blocks?|Warns?|Suggests?)\s*:/i;
  let section = '';
  let current = null;
  let sawAuditedOut = false;
  for (const line of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      section = h[1].trim().toLowerCase();
      if (/^audited out/.test(section)) sawAuditedOut = true;
      current = null;
      continue;
    }
    if (/^audited out\s*:/i.test(line.trim())) sawAuditedOut = true;
    const inKilled = /^audited out/.test(section);
    if (/^(looks good|what i could not check|staff check|summary|digest|specialists dispatched)/.test(section)) { current = null; continue; }
    const m = entryRe.exec(line) || compactRe.exec(line);
    if (m) {
      const map = inKilled ? killed : survivors;
      current = { map, id: 'R' + m[2], indent: m[1].length };
      add(map, current.id, line);
      continue;
    }
    if (!inKilled && topRe.test(line)) {
      for (const part of line.split(/(?=\bR\d+\b)/)) {
        const idm = /^R(\d+)\b/.exec(part);
        if (idm) add(survivors, 'R' + idm[1], part);
      }
      current = null;
      continue;
    }
    if (current && /^\s+\S/.test(line) && line.search(/\S/) > current.indent) {
      const t = line.trim();
      if (/^[-*]\s+\*\*(Receipt|Expected|Actual|Screenshot|Evidence):\*\*/i.test(t)) { entryOf(current.map, current.id).evidence += t + '\n'; continue; }
      if (/^[-*]\s+split:/i.test(t)) { entryOf(current.map, current.id).split += t + '\n'; continue; }
      add(current.map, current.id, line);
      continue;
    }
    current = null;
  }
  for (const id of killed.keys()) survivors.delete(id);
  return { survivors: [...survivors.values()], killed: [...killed.values()], hasAuditedOut: sawAuditedOut };
}

// Lowercase words, markdown and punctuation dropped, for comparing a finding's
// sentence with the report line it was formatted into.
function normWords(s) {
  return String(s || '').toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9%.\/-]+/g, ' ').trim();
}

// The report entries a raw finding was formatted into. The orchestrator copies a
// finding's `what` into its entry line unchanged (review.md, Phase 5), so the
// sentence is looked up inside each entry's text; findings that share a dedup
// `key` were merged into one entry, so a link found for one is a link for all.
function linkRaw(raws, entries) {
  const links = raws.map(() => []);
  raws.forEach((r, i) => {
    const what = normWords(r.what);
    if (what.length < 20) return;
    for (const e of entries) if (normWords(e.text).includes(what)) links[i].push(e.id);
  });
  const byKey = new Map();
  raws.forEach((r, i) => { if (r.key) byKey.set(r.key, [...(byKey.get(r.key) || []), i]); });
  for (const group of byKey.values()) {
    const ids = [...new Set(group.flatMap(i => links[i]))];
    for (const i of group) links[i] = ids;
  }
  return links;
}

// True when a report entry ({refs, text}) catches `bug`. Its file references
// and words come from its own lines, never from its evidence.
function entryMatches(bug, entry) {
  const refs = entry.refs.length > 0 ? entry.refs : [{ file: '', line: null }];
  return refs.some(r => bugMatches(bug, { file: r.file, line: r.line, text: entry.text }));
}

// The mapper's module blocks: heading, purpose, and the whole block text.
function parseMapperOutput(text) {
  const blocks = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = { heading: h[1].replace(/`/g, ''), purpose: '', body: '' }; blocks.push(cur); continue; }
    if (!cur) continue;
    cur.body += line + '\n';
    const p = /^\*\*Purpose:\*\*\s*(.*)$/.exec(line.trim());
    if (p) cur.purpose = p[1].trim();
  }
  return blocks;
}

// The same file on the other side of the build: plugin/<dir>/x <-> .claude/<dir>/x
// for the four folders build-plugin.js copies across. Null for any other path.
function twinOf(rel) {
  const p = normPath(rel);
  let m = /^plugin\/(agents|commands|skills|scripts)\/(.+)$/.exec(p);
  if (m) return '.claude/' + m[1] + '/' + m[2];
  m = /^\.claude\/(agents|commands|skills|scripts)\/(.+)$/.exec(p);
  if (m) return 'plugin/' + m[1] + '/' + m[2];
  return null;
}

// The chunk files the mapper covered: described in a block whose Purpose is not
// "purpose unclear" (named in it, or under a folder its heading names), and
// opened with Read, or its twin was.
function mapperCoverage(files, opened, blocks) {
  const openedSet = new Set([...opened].map(normPath));
  const described = new Set();
  for (const f of files) {
    const rel = normPath(f);
    for (const b of blocks) {
      if (/purpose unclear/i.test(b.purpose) || b.purpose === '') continue;
      const heading = normPath(b.heading.split(/\s+\(|\s+-\s+|,\s*/)[0]);
      const underFolder = heading.endsWith('/') && rel.startsWith(heading);
      if (b.heading.includes(rel) || b.body.includes(rel) || underFolder) { described.add(rel); break; }
    }
  }
  const covered = [];
  const viaTwin = [];
  for (const f of files) {
    const rel = normPath(f);
    if (!described.has(rel)) continue;
    if (openedSet.has(rel)) covered.push(rel);
    else if (twinOf(rel) && openedSet.has(twinOf(rel))) { covered.push(rel); viaTwin.push(rel); }
  }
  return { described: [...described], covered, viaTwin };
}

// Absolute paths a tool call reaches. Read/Grep/Glob paths are resolved against
// the session's working folder; a shell command only contributes paths under a
// user home or a Windows mount, the places a scratch run has no business in.
function toolPaths(name, input, cwd) {
  const out = [];
  if (!input || typeof input !== 'object') return out;
  const add = p => { if (typeof p === 'string' && p.trim() !== '') out.push(path.resolve(cwd, p)); };
  if (name === 'Read' || name === 'NotebookRead') add(input.file_path || input.notebook_path);
  else if (name === 'Grep' || name === 'Glob' || name === 'LS') { add(input.path); if (name === 'Glob' && typeof input.pattern === 'string' && input.pattern.startsWith('/')) add(input.pattern.replace(/[*?[{].*$/, '')); }
  else if (name === 'Bash' && typeof input.command === 'string') {
    const re = /(?:^|[\s'"=:(<>|])((?:\/home|\/mnt|\/root|\/Users)\/[^\s'"|;&)<>]*)/g;
    let m;
    while ((m = re.exec(input.command)) !== null) out.push(m[1]);
  }
  return out;
}

function isUnder(p, root) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The transcript records' tool calls, models, texts and denials, flattened.
function digestRecords(records) {
  const d = { models: [], toolUses: [], texts: [], errors: [], handback: null, lastText: '' };
  for (const r of records) {
    const msg = r && r.message;
    if (r && r.type === 'assistant' && msg) {
      if (msg.model) d.models.push(msg.model);
      const content = Array.isArray(msg.content) ? msg.content : [];
      const texts = [];
      for (const c of content) {
        if (c.type === 'tool_use') {
          d.toolUses.push({ id: c.id, name: c.name, input: c.input || {} });
          if (c.name === 'SubagentHandback' && c.input && typeof c.input.message === 'string') d.handback = c.input.message;
        } else if (c.type === 'text' && typeof c.text === 'string') texts.push(c.text);
      }
      if (texts.length) { d.texts.push(...texts); d.lastText = texts.join('\n'); }
      if (msg.model === '<synthetic>') d.errors.push(texts.join('\n'));
    } else if (r && r.type === 'user' && msg && Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type !== 'tool_result' || c.is_error !== true) continue;
        const t = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : '');
        if (DENIED_RE.test(t)) d.errors.push('denied: ' + t.slice(0, 200));
      }
    }
  }
  return d;
}

// The analysis of one run, from its loaded pieces: validity, models, finder
// outputs and contract breaks, raw and surviving catches, or mapper coverage.
function analyzeRun(run, answers) {
  const meta = run.meta || {};
  const result = run.result || null;
  const reasons = [];
  const warnings = [];
  const expect = meta.expect || {};
  const a = { dir: run.dir, role: meta.role, arm: meta.arm, label: meta.label || '', valid: true, reasons, warnings };

  // The session ended cleanly.
  if (!result) reasons.push('no-result');
  else {
    if (meta.exitCode !== undefined && meta.exitCode !== 0) reasons.push('exit:' + meta.exitCode);
    if (result.is_error === true) reasons.push('error-result');
    if (result.subtype && result.subtype !== 'success') reasons.push('ended:' + result.subtype);
    if (Array.isArray(result.permission_denials) && result.permission_denials.length > 0) reasons.push('denied:' + result.permission_denials.length);
  }
  const main = digestRecords(run.main || []);
  const subs = (run.subagents || []).map(s => ({ ...s, d: digestRecords(s.records || []) }));
  // A limit shows in the harness's own messages (model <synthetic>) or in an error
  // result, never in a finding: a security finding may well say "rate limit".
  const resultFailed = !!result && (result.is_error === true || (result.subtype && result.subtype !== 'success'));
  const errorText = [resultFailed ? result.result : '', ...main.errors, ...subs.flatMap(s => s.d.errors)].filter(Boolean).join('\n');
  if (LIMIT_RE.test(errorText)) reasons.push('usage-limit');
  if ([main, ...subs.map(x => x.d)].some(s => s.errors.some(e => /^denied: /.test(e)))) reasons.push('denied-in-transcript');

  // Models: the session, the measured role, and everything else on the session family.
  const mainFams = [...new Set(main.models.filter(m => m !== '<synthetic>').map(familyOf))];
  a.models = { main: [...new Set(main.models.filter(m => m !== '<synthetic>'))], byType: {} };
  if (mainFams.length === 0) reasons.push('model:main-none');
  else if (mainFams.some(f => f !== expect.main)) reasons.push('model:main=' + mainFams.join('+'));
  for (const s of subs) {
    const type = (s.meta && s.meta.agentType) || 'unknown';
    const fams = [...new Set(s.d.models.filter(m => m !== '<synthetic>').map(familyOf))];
    a.models.byType[type] = [...new Set([...(a.models.byType[type] || []), ...s.d.models.filter(m => m !== '<synthetic>')])];
    let want = expect.main;
    const kind = /review-([a-z]+)-finder$/.exec(type);
    if (expect.byType && expect.byType[type]) want = expect.byType[type];
    else if (kind) want = (expect.finderModels && expect.finderModels[kind[1]]) || expect.finders || expect.main;
    else if (/index-mapper$/.test(type)) want = expect.mapper || expect.main;
    else if (!/^(tk:)?(audit-skeptic|fix-verifier|plan-critic|design-critic|design-comparer|correction-extractor|review-[a-z]+-finder|index-mapper|review-finder)$/.test(type)) warnings.push('other-agent:' + type);
    if (fams.length > 0 && fams.some(f => f !== want)) reasons.push('model:' + type + '=' + fams.join('+') + ' (want ' + want + ')');
  }

  // Reads stay inside the scratch run.
  const roots = [meta.paths && meta.paths.tmp, meta.paths && meta.paths.home, meta.paths && meta.paths.project, '/tmp'].filter(Boolean);
  const cwd = (meta.paths && meta.paths.project) || '/';
  const outside = [];
  for (const s of [main, ...subs.map(x => x.d)]) {
    for (const t of s.toolUses) {
      for (const p of toolPaths(t.name, t.input, cwd)) {
        if (!roots.some(r => isUnder(p, r))) outside.push(t.name + ':' + p);
      }
    }
  }
  if (outside.length) { reasons.push('outside-read:' + outside.length); a.outside = [...new Set(outside)].slice(0, 20); }

  // Cost, tokens, time.
  a.costUsd = result && typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null;
  a.wallMs = meta.wallMs || (result && result.duration_ms) || null;
  a.tokens = result && result.usage ? result.usage : null;
  a.modelUsage = result && result.modelUsage ? result.modelUsage : null;
  a.turns = result && result.num_turns;

  if (meta.role === 'probe') a.probe = meta.probe || null;
  if (meta.role === 'review' || (meta.role === 'probe' && meta.probe === 'review')) analyzeReview(a, run, subs, answers, reasons, warnings);
  else if (meta.role === 'mapper') analyzeMapper(a, run, main, subs, reasons);

  // The model-mode checks (plan Step 7): failures do not void the run's catches,
  // so they are kept apart from validity and decide the exit code on their own.
  a.checks = expectChecks(expect, main, run);
  const modeCheck = a.checks.find(c => c.name === 'mode line');
  if (modeCheck && modeCheck.ok && modeCheck.where === 'report') warnings.push('mode-line-only-in-report');
  else if (modeCheck && modeCheck.ok && !modeCheck.first) warnings.push('mode-line-not-first');
  // /review also opens its report with the scope line that carries the mode.
  if (expect.modeLine && run.report && !MODE_RE.test(run.report.split('\n').slice(0, 12).join('\n'))) warnings.push('report-opens-without-mode-line');

  a.valid = reasons.length === 0;
  return a;
}

function analyzeReview(a, run, subs, answers, reasons, warnings) {
  const bugs = answers.bugs;
  a.finders = {};
  // A contract break is what the review itself treats as one (review.md, Phase 2):
  // output it cannot use (neither JSONL nor NO FINDINGS), or a finder it had to
  // dispatch again. Prose wrapped around usable JSONL lines is counted apart, as a
  // format note: the review reads the lines and moves on, and Opus finders on the
  // shipped prompts did it in 2 of 8 lenses on the first measured run.
  a.contractBreaks = 0;
  a.wrapped = 0;
  a.raised = {};
  a.survived = {};
  a.killedRaised = {};
  // Findings that matched no planted bug, kept so the matcher can be checked by eye.
  a.unmatchedRaw = [];
  a.unmatchedSurvivors = [];
  for (const b of bugs) { a.raised[b.id] = []; a.survived[b.id] = []; }
  const kinds = (run.meta && run.meta.lenses) || FINDER_KINDS;
  for (const k of kinds) a.finders[k] = [];
  const raws = [];
  for (const s of subs) {
    const type = (s.meta && s.meta.agentType) || '';
    const km = /review-([a-z]+)-finder$/.exec(type);
    if (!km || !a.finders[km[1]]) continue;
    const out = s.d.handback !== null ? s.d.handback : s.d.lastText;
    const parsed = parseFinderOutput(out);
    const unusable = !parsed.empty && !parsed.noFindings && parsed.findings.length === 0;
    a.finders[km[1]].push({ agentId: s.agentId, empty: parsed.empty, noFindings: parsed.noFindings, count: parsed.findings.length, unusable, broken: parsed.broken });
    if (parsed.findings.length > 0 && parsed.broken.length > 0) a.wrapped++;
    for (const f of parsed.findings) {
      const mf = rawToMatchable(f);
      const hits = bugs.filter(b => bugMatches(b, mf)).map(b => b.id);
      raws.push({ kind: km[1], what: String(f.what), key: typeof f.key === 'string' ? f.key : '', file: mf.file + (mf.line ? ':' + mf.line : ''), hits });
      for (const id of hits) a.raised[id].push({ kind: km[1], severity: f.severity, what: String(f.what).slice(0, 160) });
    }
  }
  for (const k of kinds) {
    const attempts = a.finders[k];
    if (attempts.length === 0) reasons.push('missing-lens:' + k);
    else if (attempts[attempts.length - 1].empty) reasons.push('empty-finder:' + k);
    if (attempts.length > 1 || attempts.some(x => x.unusable)) a.contractBreaks++;
  }
  if (!run.report) { reasons.push('no-report'); return; }
  const rep = parseReport(run.report);
  a.reportFile = run.reportFile || null;
  a.survivorCount = rep.survivors.length;
  a.killedCount = rep.killed.length;
  if (!rep.hasAuditedOut) warnings.push('no-audited-out-section');
  // A bug survived when a report entry that is still standing carries it: an
  // entry a matching raw finding was formatted into, or one whose own words
  // match. A raised bug whose entries all sit in Audited out was killed.
  const toSurvivor = linkRaw(raws, rep.survivors);
  const toKilled = linkRaw(raws, rep.killed);
  const short = e => e.text.replace(/\s+/g, ' ').trim().slice(0, 200);
  a.killedVia = {};
  for (const b of bugs) {
    const ids = new Set();
    raws.forEach((r, i) => { if (r.hits.includes(b.id)) toSurvivor[i].forEach(id => ids.add(id)); });
    for (const e of rep.survivors) if (entryMatches(b, e)) ids.add(e.id);
    a.survived[b.id] = rep.survivors.filter(e => ids.has(e.id)).map(e => ({ id: e.id, text: short(e) }));
    const killedIds = new Set();
    raws.forEach((r, i) => { if (r.hits.includes(b.id)) toKilled[i].forEach(id => killedIds.add(id)); });
    a.killedVia[b.id] = [...killedIds];
    a.killedRaised[b.id] = a.raised[b.id].length > 0 && a.survived[b.id].length === 0;
  }
  const counted = new Set(Object.values(a.survived).flat().map(e => e.id));
  for (const e of rep.survivors) if (!counted.has(e.id)) a.unmatchedSurvivors.push({ id: e.id, text: short(e) });
  for (const r of raws) if (r.hits.length === 0) a.unmatchedRaw.push({ kind: r.kind, file: r.file, what: r.what.slice(0, 160) });
  if (run.projectGit && /^\s*[MADRC?]/m.test(run.projectGit.status || '')) warnings.push('project-changed');
}

function analyzeMapper(a, run, main, subs, reasons) {
  const meta = run.meta || {};
  const files = (meta.chunk && meta.chunk.files) || [];
  const mappers = subs.filter(s => /index-mapper$/.test((s.meta && s.meta.agentType) || ''));
  if (mappers.length !== 1) { reasons.push('dispatch-count:' + mappers.length); return; }
  const m = mappers[0];
  const dispatch = main.toolUses.find(t => (t.name === 'Agent' || t.name === 'Task') && m.meta && t.id === m.meta.toolUseId);
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  if (!dispatch) reasons.push('dispatch-not-found');
  else {
    if (meta.expectedPrompt && norm(dispatch.input.prompt) !== norm(meta.expectedPrompt)) reasons.push('prompt-mismatch');
    if (dispatch.input.model) reasons.push('model-param:' + dispatch.input.model);
  }
  const out = m.d.handback !== null ? m.d.handback : m.d.lastText;
  if (String(out || '').trim() === '') { reasons.push('empty-mapper'); return; }
  const project = meta.paths && meta.paths.project;
  const opened = new Set();
  for (const t of m.d.toolUses) {
    if (t.name !== 'Read' || !t.input || typeof t.input.file_path !== 'string') continue;
    const abs = path.resolve(project || '/', t.input.file_path);
    opened.add(project ? normPath(path.relative(project, abs)) : normPath(t.input.file_path));
  }
  const blocks = parseMapperOutput(out);
  const cov = mapperCoverage(files, opened, blocks);
  a.mapper = { files: files.length, opened: opened.size, blocks: blocks.length, described: cov.described.length, covered: cov.covered.length, viaTwin: cov.viaTwin.length };
  a.covered = cov.covered;
}

// Was `id` caught in analysis `a`?
function caught(a, id) {
  if (a.role === 'mapper') return (a.covered || []).includes(id);
  return !!(a.survived && a.survived[id] && a.survived[id].length > 0);
}

function mean(xs) {
  const v = xs.filter(x => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

// Scores one candidate set against a baseline set (arrays of analyses) per the
// rules in the header. `ids` lists what can be caught: bug ids, or chunk files.
function scoreSets(candidate, baseline, ids, opts) {
  const o = opts || {};
  const vb = baseline.filter(x => x.valid);
  const vc = candidate.filter(x => x.valid);
  const s = {
    baselineRuns: baseline.length, baselineValid: vb.length, candidateRuns: candidate.length, candidateValid: vc.length,
    invalid: [...baseline, ...candidate].filter(x => !x.valid).map(x => ({ dir: x.dir, reasons: x.reasons })),
    stable: [], noisy: [], never: [], perId: {}, failed: [], single: [], verdict: '', why: [],
    costUsd: mean(vc.map(x => x.costUsd)), baselineCostUsd: mean(vb.map(x => x.costUsd)),
    wallMs: mean(vc.map(x => x.wallMs)), baselineWallMs: mean(vb.map(x => x.wallMs)),
  };
  if (vb.length === 0) { s.verdict = 'INVALID'; s.why.push('no valid baseline run'); return s; }
  if (vc.length === 0) { s.verdict = 'INVALID'; s.why.push('no valid candidate run'); return s; }
  for (const id of ids) {
    const inB = vb.filter(x => caught(x, id)).length;
    const inC = vc.filter(x => caught(x, id)).length;
    const raisedC = vc.filter(x => x.raised && x.raised[id] && x.raised[id].length > 0).length;
    s.perId[id] = { baseline: inB + '/' + vb.length, candidate: inC + '/' + vc.length, raisedCandidate: raisedC + '/' + vc.length };
    if (inB === vb.length) s.stable.push(id);
    else if (inB > 0) s.noisy.push(id);
    else s.never.push(id);
  }
  for (const id of s.stable) {
    const misses = vc.length - vc.filter(x => caught(x, id)).length;
    if (misses >= 2) s.failed.push(id);
    else if (misses === 1 && vc.length === 1) s.single.push(id);
  }
  const breakRuns = vc.filter(x => (x.contractBreaks || 0) > 0).length;
  if (o.knownId && o.requireKnown && !s.stable.includes(o.knownId)) {
    s.verdict = 'PAGE';
    s.why.push('the known-answer case is not a stable baseline catch, so the bar for this arm cannot be applied');
    return s;
  }
  if (s.failed.length) s.why.push('missed twice: ' + s.failed.join(', '));
  if (breakRuns >= 2) s.why.push('contract breaks in ' + breakRuns + ' runs');
  if (s.failed.length || breakRuns >= 2) { s.verdict = 'FAIL'; return s; }
  if (s.single.length || (breakRuns === 1 && vc.length === 1)) {
    s.verdict = 'RERUN';
    if (s.single.length) s.why.push('missed once in a single run: ' + s.single.join(', '));
    if (breakRuns === 1 && vc.length === 1) s.why.push('one contract break in a single run');
    return s;
  }
  s.verdict = 'PASS';
  return s;
}

// ---------------------------------------------------------------------------
// Loading a saved run
// ---------------------------------------------------------------------------

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* a torn last line is skipped */ }
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Everything analyzeRun reads, from a run folder.
function loadRun(dir) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const result = readJson(path.join(dir, 'result.json'));
  const files = walk(path.join(dir, 'transcripts'));
  const sessionId = result && result.session_id;
  const mains = files.filter(f => /\.jsonl$/.test(f) && !/\/subagents\//.test(f));
  const mainFile = mains.find(f => sessionId && path.basename(f) === sessionId + '.jsonl') || mains[0] || null;
  const subagents = files.filter(f => /\/subagents\/agent-[^/]+\.jsonl$/.test(f)).map(f => ({
    agentId: path.basename(f).replace(/^agent-|\.jsonl$/g, ''),
    meta: readJson(f.replace(/\.jsonl$/, '.meta.json')) || {},
    records: readJsonl(f),
  }));
  const reports = walk(path.join(dir, 'project-reports')).filter(f => /\/review-orchestrator-[^/]+\.md$/.test(f)).sort();
  const reportFile = reports.length ? reports[reports.length - 1] : null;
  const gitFile = path.join(dir, 'project-git.json');
  // The scratch project's plans as the session left them, by file name.
  const plans = {};
  for (const f of walk(path.join(dir, 'project-plans')).filter(f => /\.md$/.test(f))) plans[path.basename(f)] = fs.readFileSync(f, 'utf8');
  return {
    dir, meta, result,
    main: mainFile ? readJsonl(mainFile) : [],
    subagents,
    report: reportFile ? fs.readFileSync(reportFile, 'utf8') : null,
    reportFile,
    projectGit: readJson(gitFile),
    plans,
  };
}

function loadAnswers() {
  return JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8'));
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function sh(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  return r;
}

// Git with this machine's own config kept out: the scratch repos must not pick
// up a signing key, a global hook or a default branch name.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(args, cwd, extraEnv) {
  const r = sh('git', args, { cwd, env: { ...GIT_ENV, ...(extraEnv || {}) } });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}

// Copies a fixture snapshot, undoing the names that keep it inert in this repo:
// a `dot-x` segment becomes `.x`, and a `.fixture` suffix is dropped.
function copyFixture(src, dest) {
  for (const file of walk(src)) {
    const rel = path.relative(src, file).split(path.sep)
      .map(seg => seg.startsWith('dot-') ? '.' + seg.slice(4) : seg)
      .join(path.sep).replace(/\.fixture$/, '');
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  }
}

function fixtureHash() {
  const h = crypto.createHash('sha256');
  for (const f of walk(path.join(FIXTURE)).filter(f => /\/(base|change)\//.test(f)).sort()) {
    h.update(path.relative(FIXTURE, f) + '\0');
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

// The review fixture as a two-commit repo; returns the two commit ids.
function buildReviewProject(project, planModels) {
  fs.mkdirSync(project, { recursive: true });
  copyFixture(path.join(FIXTURE, 'base'), project);
  if (planModels) {
    const planFile = path.join(project, 'plans', 'PLAN-fixture.md');
    const text = fs.readFileSync(planFile, 'utf8').replace(/(\*\*Overall Progress:\*\*[^\n]*\n)/, '$1**Models:** ' + planModels + '\n');
    fs.writeFileSync(planFile, text);
  }
  const who = ['-c', 'user.name=Notebook Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false'];
  git(['init', '-q', '-b', 'main'], project);
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', 'Notes app'], project, { GIT_AUTHOR_DATE: '2026-09-30T12:00:00Z', GIT_COMMITTER_DATE: '2026-09-30T12:00:00Z' });
  const base = git(['rev-parse', 'HEAD'], project);
  copyFixture(path.join(FIXTURE, 'change'), project);
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', 'Add search, export, clear all, backups, import and a reset command'], project, { GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' });
  const change = git(['rev-parse', 'HEAD'], project);
  return { base, change };
}

// The plugin build under test, extracted or built into a cache-shaped folder
// inside the scratch home (setup-project.js fills the plugin's script rows only
// for a build under plugins/cache/<marketplace>/tk/<version>; LESSONS, #206).
function prepareBuild(spec, home, tmp) {
  let sha = null;
  let version;
  let dest;
  if (spec === 'tree') {
    version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    dest = path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', version);
    const r = sh(process.execPath, [path.join(REPO, 'scripts', 'build-plugin.js'), '--out', dest, '--version', version], { cwd: REPO });
    if (r.status !== 0) throw new Error('build-plugin.js failed: ' + r.stderr);
  } else {
    sha = git(['rev-parse', '--verify', spec + '^{commit}'], REPO);
    version = JSON.parse(git(['show', sha + ':plugin/.claude-plugin/plugin.json'], REPO)).version;
    dest = path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', version);
    const tar = path.join(tmp, 'plugin.tar');
    git(['archive', '-o', tar, sha, 'plugin'], REPO);
    const x = path.join(tmp, 'extract');
    fs.mkdirSync(x, { recursive: true });
    const r = sh('tar', ['-xf', tar, '-C', x]);
    if (r.status !== 0) throw new Error('tar failed: ' + r.stderr);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(path.join(x, 'plugin'), dest);
  }
  // browse.js needs playwright-core; a real install has it at the plugin root.
  if (fs.existsSync(NODE_MODULES) && !fs.existsSync(path.join(dest, 'node_modules'))) fs.symlinkSync(NODE_MODULES, path.join(dest, 'node_modules'));
  return { dir: dest, version, sha };
}

// The arm's settings for the measured agents, read against the build's files.
function armSettings(role, arm, build, effortFlag) {
  const files = role === 'mapper' ? ['index-mapper'] : FINDER_KINDS.map(k => 'review-' + k + '-finder');
  const out = [];
  for (const name of files) {
    const file = path.join(build.dir, 'agents', name + '.md');
    const text = fs.readFileSync(file, 'utf8');
    const current = frontmatterValue(text, 'effort') || 'high';
    let model;
    let effort;
    if (arm === 'ship') {
      // As shipped: nothing is patched, so --effort does not apply.
      out.push({ file, name, before: { model: frontmatterValue(text, 'model'), effort: current }, model: frontmatterValue(text, 'model'), effort: current, shipped: true });
      continue;
    }
    if (arm === 'a') { model = SESSION_MODEL; effort = role === 'mapper' ? 'medium' : current; }
    else if (arm === 'b') { model = SESSION_MODEL; effort = lowerEffort(role === 'mapper' ? 'medium' : current); }
    else if (arm === 'c') { model = 'sonnet'; effort = effortFlag; }
    else throw new Error('unknown arm ' + arm);
    if (effortFlag) effort = effortFlag;
    if (!effort) throw new Error('arm c needs --effort <level> (the effort decided by arms a and b)');
    if (!EFFORTS.includes(effort)) throw new Error('unknown effort level ' + effort);
    out.push({ file, name, before: { model: frontmatterValue(text, 'model'), effort: current }, model, effort });
  }
  return out;
}

function applyArm(settings) {
  for (const s of settings) if (!s.shipped) fs.writeFileSync(s.file, patchAgent(fs.readFileSync(s.file, 'utf8'), { model: s.model, effort: s.effort }));
}

// The family each helper a mode moves should answer on, read from the build's
// agent files as they stand now (after the arm's patch).
function finderModels(mode, buildDir, sessionFamily) {
  const read = name => fs.readFileSync(path.join(buildDir, 'agents', name + '.md'), 'utf8');
  return Object.fromEntries(FINDER_KINDS.map(k => [k, modeFamily(mode, read('review-' + k + '-finder'), sessionFamily)]));
}
function mapperModel(mode, buildDir, sessionFamily) {
  return modeFamily(mode, fs.readFileSync(path.join(buildDir, 'agents', 'index-mapper.md'), 'utf8'), sessionFamily);
}

// Windows browser launchers that do nothing, first on PATH, so a review's
// local open (open-artifact.sh) opens no window on the owner's desktop.
function makeShims(tmp) {
  const dir = path.join(tmp, 'shim');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['powershell.exe', 'explorer.exe', 'wslview', 'xdg-open']) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(f, 0o755);
  }
  return dir;
}

function sessionEnv(tmp, extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^CLAUDE_CODE_SUBAGENT_MODEL/.test(k) || /^ANTHROPIC_(MODEL|DEFAULT_|SMALL_FAST_MODEL)/.test(k) || k === 'CLAUDE_CODE_EFFORT_LEVEL') delete env[k];
  }
  env.PATH = makeShims(tmp) + path.delimiter + env.PATH;
  const browsers = path.join(REAL_HOME, '.cache', 'ms-playwright');
  if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  return { ...env, ...(extra || {}) };
}

// The owner's real config, hashed the way headless-session.sh --baseline lists it,
// except that a marketplace's lastUpdated stamp is left out: Claude Code's own
// sessions bump it when they check for updates (2026-10-03, during the first
// measured run, with the marketplace content unchanged since that morning), and a
// check must judge what a run can change, not what the owner's sessions also write
// (LESSONS, issues 172-177).
const REAL_CONFIG_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.claude/plugins/installed_plugins.json',
  '.claude/plugins/known_marketplaces.json', '.claude/plugins/blocklist.json', '.claude/correction-ledger.jsonl',
  '.claude/correction-heartbeat.jsonl', '.claude/correction-rollup.json'];
// The owner's correction files only ever grow, and every session the owner runs,
// in any project, may add to them: during a Step 7 run on 2026-10-03, a session
// in another of the owner's repositories added a heartbeat line, and the run
// stopped. A change there counts as the run's own only when the old bytes were
// rewritten or an added line names the run's scratch folder (appendSource).
const APPEND_ONLY = new Set(['.claude/correction-ledger.jsonl', '.claude/correction-heartbeat.jsonl']);
const shortHash = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

// Who grew an append-only file: 'rewritten' when its first `beforeSize` bytes no
// longer hash to `beforeHash`, 'run' when an added line names `scratch`, else 'other'.
function appendSource(beforeHash, beforeSize, afterBuf, scratch) {
  if (afterBuf.length < beforeSize || shortHash(afterBuf.subarray(0, beforeSize)) !== beforeHash) return 'rewritten';
  return afterBuf.subarray(beforeSize).toString('utf8').includes(scratch) ? 'run' : 'other';
}

function realConfigSnapshot() {
  const snap = {};
  for (const rel of REAL_CONFIG_FILES) {
    const abs = path.join(REAL_HOME, rel);
    if (!fs.existsSync(abs)) { snap[rel] = { raw: 'missing', norm: 'missing' }; continue; }
    const buf = fs.readFileSync(abs);
    const text = buf.toString('utf8');
    let norm = text;
    if (rel.endsWith('known_marketplaces.json')) {
      try { const j = JSON.parse(text); for (const v of Object.values(j)) if (v && typeof v === 'object') delete v.lastUpdated; norm = JSON.stringify(j); } catch (e) { norm = text; }
    }
    snap[rel] = { raw: shortHash(buf), norm: shortHash(norm) };
    if (APPEND_ONLY.has(rel)) Object.assign(snap[rel], { size: buf.length, buf });
  }
  let link = 'none';
  try { link = fs.readlinkSync(path.join(REAL_HOME, '.claude', 'plugins', 'data', 'tk-llm-peer-review', 'current')); } catch (e) { link = 'none'; }
  snap['current-link'] = { raw: link, norm: link };
  return snap;
}
// scratch: the run's scratch folder, which a line the run itself wrote would name.
function compareSnapshots(before, after, scratch) {
  const changed = [];
  const stampOnly = [];
  const otherSessions = [];
  for (const k of Object.keys(before)) {
    const b = before[k];
    const a = after[k] || {};
    if (b.norm === a.norm) { if (b.raw !== a.raw) stampOnly.push(k); continue; }
    const src = APPEND_ONLY.has(k) && scratch && b.size !== undefined && a.buf ? appendSource(b.raw, b.size, a.buf, scratch) : null;
    if (src === 'other') otherSessions.push(k);
    else changed.push(k + (src === 'run' ? ' (a line names this run)' : src === 'rewritten' ? ' (earlier lines rewritten)' : ''));
  }
  return { unchanged: changed.length === 0, changed, stampOnly, otherSessions };
}

function claudeVersion() {
  const r = sh('bash', ['-c', 'ls -d "$HOME"/.cursor-server/extensions/anthropic.claude-code-*/resources/native-binary/claude "$HOME"/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1']);
  const bin = process.env.CLAUDE_BIN || r.stdout.trim();
  if (!bin) return null;
  const v = sh(bin, ['--version']);
  return v.stdout.trim();
}

// Every process group this run started and has not stopped yet: the session and
// the fixture server. Both are detached into groups of their own, so a Ctrl-C in
// the terminal reaches neither; onInterrupt stops them (review R2, R3).
const liveGroups = new Set();
let sessionGroup = null;
let interrupted = false;

function stopGroup(pid, signal) {
  try { process.kill(-pid, signal || 'SIGTERM'); } catch (e) { /* already gone */ }
}

// The first interrupt stops every live group. With a session under way, the run
// then finishes its own cleanup and ledger line and leaves with 130; otherwise it
// leaves at once. A second interrupt always leaves at once.
function onInterrupt(signal) {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.log('quality-check: ' + signal + ': stopping the session and the fixture server (interrupt again to leave at once)');
  for (const pid of liveGroups) stopGroup(pid);
  if (!sessionGroup) process.exit(130);
}

// Runs one command as the leader of a new process group, so a timeout stops
// everything it started. The session wrapper does not exec claude, and the old
// spawnSync timeout signalled the wrapper alone: the paid session ran on,
// unrecorded, past its deleted scratch home (review R3). Resolves
// { status, stdout, stderr, timedOut, wallMs }; status is 124 on a timeout or a signal.
function runGroup(cmd, args, opts, timeoutMs, graceMs = KILL_GRACE_MS) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) liveGroups.add(child.pid);
    const out = [];
    const err = [];
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child.pid, 'SIGTERM');
      setTimeout(() => stopGroup(child.pid, 'SIGKILL'), graceMs).unref();
    }, timeoutMs);
    // Once the leader exits, anything it left running in its group goes too, so
    // a leftover holding the output pipe cannot keep the run waiting.
    child.on('exit', () => stopGroup(child.pid));
    const finish = (code, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.pid) liveGroups.delete(child.pid);
      resolve({
        status: timedOut || code === null ? 124 : code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8') + (error ? '\n' + error.message : ''),
        timedOut, wallMs: Date.now() - started,
      });
    };
    child.on('error', e => finish(null, e));
    child.on('close', code => finish(code));
  });
}

// One headless session through scripts/setup/headless-session.sh.
async function runSession(o) {
  const args = [HARNESS, '--build', o.build, '--project', o.project, '--home', o.home, '--mode', 'bypassPermissions', '--',
    '--model', o.sessionModel || SESSION_MODEL, '--effort', SESSION_EFFORT, '--output-format', 'json', '--max-budget-usd', String(o.maxUsd),
    '--strict-mcp-config', '--disallowedTools', 'Artifact,ArtifactComments,ArtifactData',
    '--append-system-prompt', SYSTEM_NOTE, o.prompt];
  const run = runGroup('bash', args, { cwd: REPO, env: o.env }, SESSION_TIMEOUT_MS);
  sessionGroup = run;
  try { return await run; } finally { sessionGroup = null; }
}

function httpOk(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer(project) {
  if (await httpOk(PORT)) throw new Error('port ' + PORT + ' already answers; stop whatever runs there (another quality-check run?) and retry');
  const child = spawn(process.execPath, ['--require', LOOPBACK_PRELOAD, 'server.js'], { cwd: project, env: { ...process.env, PORT: String(PORT) }, detached: true, stdio: 'ignore' });
  child.unref();
  liveGroups.add(child.pid);
  for (let i = 0; i < 50; i++) {
    if (await httpOk(PORT)) return child.pid;
    await new Promise(r => setTimeout(r, 200));
  }
  stopServer(child.pid);
  throw new Error('the fixture server did not start on port ' + PORT);
}

function stopServer(pid) {
  if (!pid) return;
  stopGroup(pid);
  liveGroups.delete(pid);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, dereference: false, verbatimSymlinks: true });
}

// ---------------------------------------------------------------------------
// Budget and ledger
// ---------------------------------------------------------------------------

function ledger() {
  return fs.existsSync(LEDGER) ? readJsonl(LEDGER) : [];
}

// The scratch home links the owner's credentials file. A session that refreshes
// its login token writes the new one by replacing that link with a file, so the
// new token stays in the scratch home, which is removed, while the owner's file
// keeps the token the refresh retired (seen on the second post-#207 run: the run
// was voided and the owner may have to sign in again). A run that ends before
// the owner's token expires never refreshes, so a run starts only when the token
// outlasts the session timeout plus a margin. No credentials file, or one with no
// expiry (an API key login), raises nothing. Returns a reason, or null.
function tokenWindowProblem(credentialsText, nowMs, needMs) {
  if (credentialsText === null) return null;
  let expiresAt;
  try { expiresAt = (JSON.parse(credentialsText).claudeAiOauth || {}).expiresAt; } catch (e) { return null; }
  if (typeof expiresAt !== 'number') return null;
  const left = expiresAt - nowMs;
  if (left >= needMs) return null;
  return 'the login token expires in ' + Math.max(0, Math.round(left / 60000)) + ' min, under the ' + Math.round(needMs / 60000) +
    ' min a run may take; a scratch session would refresh it and leave the real file stale. Let a normal Claude Code session refresh it, then run again.';
}
const TOKEN_MARGIN_MS = 15 * 60 * 1000;

function budgetCheck(role) {
  const rows = ledger();
  const spent = rows.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const approval = readJson(BUDGET);
  const measured = rows.filter(r => r.role === 'review' || r.role === 'mapper');
  if (!approval) {
    if (measured.length === 0) return { ok: true, spent, note: 'first measured run: no approval needed yet; its cost sizes the request' };
    return { ok: false, spent, page: 'Budget stop: the first measured run is done and the owner has not approved a budget. Ask the owner, then record the answer with --approve <usd>.' };
  }
  const sameRole = rows.filter(r => r.role === role && typeof r.costUsd === 'number').map(r => r.costUsd);
  const estimate = sameRole.length ? Math.max(...sameRole) : DEFAULT_MAX_USD[role] || DEFAULT_MAX_USD.probe;
  if (spent + estimate > approval.approvedUsd) {
    return { ok: false, spent, page: 'Budget stop: $' + spent.toFixed(2) + ' spent of $' + Number(approval.approvedUsd).toFixed(2) + ' approved, and the next ' + role + ' run may cost up to $' + estimate.toFixed(2) + '. Ask the owner whether to raise the budget (--approve <usd>) or stop.' };
  }
  return { ok: true, spent, note: '$' + spent.toFixed(2) + ' spent of $' + Number(approval.approvedUsd).toFixed(2) + ' approved' };
}

// A run's ledger cost: the figure its session reported, or, when it ended without
// one (a timeout, a crash, an interrupt), its cap, marked costCapped, so the
// spend total never comes out low (review R14).
function ledgerCost(reported, maxUsd) {
  return typeof reported === 'number' ? { costUsd: reported } : { costUsd: maxUsd, costCapped: true };
}

function appendLedger(row) {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function mapperTemplate(buildDir) {
  const text = fs.readFileSync(path.join(buildDir, 'commands', 'index.md'), 'utf8');
  const step3 = text.indexOf('### Step 3');
  const open = text.indexOf('<template>', step3);
  const close = text.indexOf('</template>', open);
  if (step3 === -1 || open === -1 || close === -1) throw new Error('could not find the Step 3 template in the build\'s commands/index.md');
  return text.slice(open + '<template>'.length, close).trim();
}

function fillMapperTemplate(template, files) {
  const line = template.split('\n').find(l => /\{for each file:/.test(l));
  if (!line) throw new Error('the Step 3 template has no file-list line');
  return template.replace(line, files.map(f => '- ' + f).join('\n'));
}

// The execute-mismatch probe's plan: one small step, Models line fit.
const MISMATCH_PLAN = '# README Note Plan\n\n**Overall Progress:** `0%`\n**Models:** fit\n\n## TLDR\n'
  + 'One sentence in the README about note length.\n\n## Tasks\n'
  + '- [ ] 🟥 **Step 1: README note** - add the sentence "Notes can be up to 500 characters." as the last line of README.md\n\n## Outcomes\n';

// Commits MISMATCH_PLAN on top of the fixture as the newest plan (session-init.js
// picks the newest plan by file time), and gives the scratch repo an identity for
// the session's own checkpoint commit: the scratch home has no git config.
function addMismatchPlan(project) {
  const old = new Date('2026-09-30T12:00:00Z');
  fs.utimesSync(path.join(project, 'plans', 'PLAN-fixture.md'), old, old);
  fs.writeFileSync(path.join(project, 'plans', 'PLAN-readme-note.md'), MISMATCH_PLAN);
  const who = ['-c', 'user.name=Notebook Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false'];
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', 'Plan a README note'], project, { GIT_AUTHOR_DATE: '2026-10-02T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T12:00:00Z' });
  git(['config', 'user.name', 'Notebook Dev'], project);
  git(['config', 'user.email', 'dev@example.com'], project);
  git(['config', 'commit.gpgsign', 'false'], project);
}

// The create-plan probe's input: an exploration's closing summary, fixed, naming cheap.
const PLAN_SUMMARY = 'Exploration summary, approved by the owner; write the plan now. '
  + 'Direction: show a word count under each note on the page. '
  + 'Scope: public/app.js only, counted in the browser when a note renders; no server change. '
  + 'Decisions: a word is a run of characters between spaces; an empty note shows "0 words" and a one-word note "1 word". '
  + 'Models: cheap. Open questions: none.';

async function commandRun(o) {
  const role = o.role;
  if (!['review', 'mapper', 'probe'].includes(role)) usage('--role must be review or mapper');
  if (role !== 'probe' && !['a', 'b', 'c', 'ship'].includes(o.arm)) usage('--arm must be a, b, c or ship');
  if (!o.build) usage('--build <git-ref|tree> is required');
  if (role === 'mapper' && !o.chunk) usage('--role mapper needs --chunk <manifest.json>');
  for (const m of [o.modeWord, o.planModels]) if (m !== undefined && !MODES.includes(m)) usage('a mode is best, fit or cheap');
  const budget = budgetCheck(role === 'probe' ? 'probe' : role);
  if (!budget.ok) { console.log(budget.page); process.exit(4); }
  let credentials = null;
  try { credentials = fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'); } catch (e) { credentials = null; }
  const tokenProblem = tokenWindowProblem(credentials, Date.now(), SESSION_TIMEOUT_MS + TOKEN_MARGIN_MS);
  if (tokenProblem) { console.log('STOP: ' + tokenProblem); process.exit(7); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-run.'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  fs.mkdirSync(home, { recursive: true });
  let build;
  try { build = prepareBuild(o.build, home, tmp); }
  catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  const buildLabel = build.sha ? build.sha.slice(0, 7) : 'tree';
  // The mode a review run resolves, named in its folder when it was chosen.
  const modeTag = o.modeWord ? '-' + o.modeWord : o.planModels ? '-plan-' + o.planModels : o.arm === 'ship' ? '-fit' : '';
  const kind = role === 'probe' ? 'probe-' + o.probe + (o.modeWord ? '-' + o.modeWord : '') : role + '-' + o.arm + modeTag;
  const out = path.join(OUT_ROOT, stamp() + '-' + kind + '-' + buildLabel + (o.label ? '-' + o.label.replace(/[^a-z0-9-]+/gi, '-') : ''));
  fs.mkdirSync(out, { recursive: true });
  // Opus, except the probe that checks /execute's note on a session running on
  // another model than the plan's build model.
  const sessionModel = o.probe === 'execute-mismatch' ? 'sonnet' : SESSION_MODEL;
  const sessionFamily = familyOf(sessionModel);
  const meta = {
    version: 1, role, arm: o.arm || null, label: o.label || '', probe: o.probe || null,
    build: { spec: o.build, sha: build.sha, version: build.version },
    session: { model: sessionModel, effort: SESSION_EFFORT, permissionMode: 'bypassPermissions', maxUsd: o.maxUsd, systemNote: SYSTEM_NOTE, claude: claudeVersion() },
    paths: { tmp, home, project, buildDir: build.dir },
    expect: { main: sessionFamily, finders: sessionFamily, mapper: sessionFamily },
    fixture: fixtureHash(), startedAt: new Date().toISOString(),
  };
  let serverPid = null;
  let envExtra = {};
  // From the session's start the run may have spent money, so from then on a
  // ledger line is written however the run ends (review R14).
  let ran = false;
  let reportedCost = null;
  let sessionDone = false;
  const enterLedger = valid => appendLedger({ at: meta.endedAt || new Date().toISOString(), role, arm: meta.arm, probe: meta.probe,
    build: o.build, sha: build.sha, ...ledgerCost(reportedCost, o.maxUsd), valid, dir: path.relative(REPO, out) });
  try {
    if (role === 'review' || (role === 'probe' && o.probe === 'review')) {
      const settings = role === 'review' ? armSettings('review', o.arm, build, o.effort) : armSettings('review', 'a', build, null);
      applyArm(settings);
      meta.patch = settings.filter(s => !s.shipped).map(s => ({ agent: s.name, before: s.before, model: s.model, effort: s.effort }));
      if (o.arm === 'ship') meta.shipped = settings.map(s => ({ agent: s.name, model: s.model, effort: s.effort }));
      // Where each finder should answer: the mode the review resolves (see Model modes).
      const mode = o.modeWord || o.planModels || 'fit';
      meta.expect.finderModels = finderModels(mode, build.dir, sessionFamily);
      const fams = [...new Set(Object.values(meta.expect.finderModels))];
      meta.expect.finders = fams.length === 1 ? fams[0] : null;
      if (o.arm === 'ship' || o.modeWord || o.planModels) {
        meta.expect.modeLine = { mode, from: o.modeWord ? 'mode:? ?word|argument' : o.planModels ? 'PLAN-fixture' : 'default' };
      }
      const commits = buildReviewProject(project, o.planModels || null);
      meta.commits = commits;
      meta.lenses = role === 'review' ? FINDER_KINDS : ['code'];
      const lensArg = meta.lenses.join(',');
      const modeWord = o.modeWord ? ' mode:' + o.modeWord : '';
      meta.prompt = '/tk:review ' + lensArg + ' ' + commits.base + '..HEAD' + modeWord + ' report only, no chaining';
      serverPid = await startServer(project);
    } else if (role === 'mapper') {
      const chunk = JSON.parse(fs.readFileSync(path.resolve(o.chunk), 'utf8'));
      meta.chunk = { file: path.relative(REPO, path.resolve(o.chunk)), sourceRef: chunk.sourceRef, files: chunk.files };
      const settings = armSettings('mapper', o.arm, build, o.effort);
      applyArm(settings);
      meta.patch = settings.filter(s => !s.shipped).map(s => ({ agent: s.name, before: s.before, model: s.model, effort: s.effort }));
      if (o.arm === 'ship') meta.shipped = settings.map(s => ({ agent: s.name, model: s.model, effort: s.effort }));
      // The dispatch below passes no model, so the mapper answers on its file's.
      meta.expect.mapper = mapperModel('fit', build.dir, sessionFamily);
      fs.mkdirSync(project, { recursive: true });
      const tar = path.join(tmp, 'source.tar');
      git(['archive', '-o', tar, chunk.sourceRef], REPO);
      const r = sh('tar', ['-xf', tar, '-C', project]);
      if (r.status !== 0) throw new Error('tar failed: ' + r.stderr);
      meta.expectedPrompt = fillMapperTemplate(mapperTemplate(build.dir), chunk.files);
      meta.prompt = 'This is a measurement run of one helper agent; do no other work. Make exactly one Agent tool call: '
        + 'subagent_type "tk:index-mapper", description "Map chunk", and as its prompt the text between the two marker lines below, '
        + 'copied exactly, byte for byte. Pass no model. When the agent returns, reply with its full output and nothing else.\n'
        + '<<<PROMPT\n' + meta.expectedPrompt + '\nPROMPT>>>';
    } else if (o.probe === 'models-override') {
      fs.mkdirSync(project, { recursive: true });
      meta.expect.byType = { 'tk:plan-critic': 'sonnet' };
      meta.prompt = 'Harness check, no other work. Make exactly one Agent tool call: subagent_type "tk:plan-critic", model "sonnet", '
        + 'description "Harness check", prompt "This is a harness check, not a plan review. Reply with the single word OK and nothing else." '
        + 'Then reply with the agent\'s answer and nothing else.';
    } else if (o.probe === 'models-inherit') {
      fs.mkdirSync(project, { recursive: true });
      const critic = path.join(build.dir, 'agents', 'plan-critic.md');
      fs.writeFileSync(critic, patchAgent(fs.readFileSync(critic, 'utf8'), { model: 'inherit' }));
      meta.patch = [{ agent: 'plan-critic', model: 'inherit' }];
      envExtra = { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' };
      meta.env = envExtra;
      // plan-critic carries model: inherit and must stay on Opus; design-critic
      // carries no model line and must move to Sonnet, which proves the variable
      // took effect (without that control, an Opus answer proves nothing).
      meta.expect.byType = { 'tk:plan-critic': 'opus', 'tk:design-critic': 'sonnet' };
      meta.prompt = 'Harness check, no other work. Make exactly two Agent tool calls, one after the other, and pass no model on either: '
        + 'first subagent_type "tk:plan-critic", then subagent_type "tk:design-critic"; description "Harness check"; the prompt for both: '
        + '"This is a harness check, not a review. Reply with the single word OK and nothing else." Then reply with both answers and nothing else.';
    } else if (o.probe === 'index-mode') {
      // /tk:index on the fixture: one chunk, so one mapper, on the mode's model.
      const mode = o.modeWord || 'fit';
      meta.commits = buildReviewProject(project, null);
      meta.expect.mapper = mapperModel(mode, build.dir, sessionFamily);
      meta.expect.byType = { 'tk:index-mapper': meta.expect.mapper };
      meta.expect.modeLine = { mode };
      meta.prompt = '/tk:index' + (o.modeWord ? ' mode:' + o.modeWord : '');
    } else if (o.probe === 'review-code-mode') {
      // A direct /tk:review-code on four changed files takes the bigger-change path
      // and fans out to review-code-finder calls, each on the mode's model.
      const mode = o.modeWord || 'fit';
      const commits = buildReviewProject(project, null);
      meta.commits = commits;
      meta.expect.finderModels = finderModels(mode, build.dir, sessionFamily);
      meta.expect.byType = { 'tk:review-code-finder': meta.expect.finderModels.code };
      meta.expect.modeLine = { mode };
      meta.prompt = '/tk:review-code' + (o.modeWord ? ' mode:' + o.modeWord : '') + ' the changes in ' + commits.base
        + '..HEAD to server.js, public/app.js, scripts/import-notes.js and scripts/rotate-backups.sh; report only, no chaining';
    } else if (o.probe === 'execute-mismatch') {
      // A Sonnet session builds a plan whose Models line is fit: /tk:execute notes in
      // one line that the plan builds on Opus, gives the fresh-session steps, and carries on.
      meta.commits = buildReviewProject(project, null);
      addMismatchPlan(project);
      meta.expect.texts = ['builds on\\W{0,4}Opus', '/model opus'];
      meta.prompt = '/tk:execute no chaining';
    } else if (o.probe === 'create-plan-cheap') {
      // /tk:create-plan from a summary naming cheap: the plan's Models line, the
      // critic on the session model, and the fresh-session close. With no map yet,
      // it runs /index mode:cheap first, so a mapper may answer too, on Sonnet.
      meta.commits = buildReviewProject(project, null);
      meta.expect.byType = { 'tk:plan-critic': sessionFamily };
      meta.expect.mapper = mapperModel('cheap', build.dir, sessionFamily);
      meta.expect.planLine = { mode: 'cheap', skip: ['PLAN-fixture.md'] };
      meta.expect.lastText = ['/model opus'];
      meta.prompt = '/tk:create-plan ' + PLAN_SUMMARY;
    } else {
      usage('unknown probe ' + o.probe);
    }
    fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log('quality-check: ' + kind + ' on ' + o.build + ' (' + build.version + ') -> ' + path.relative(REPO, out));
    console.log('quality-check: ' + budget.note);
    const env = sessionEnv(tmp, envExtra);
    const configBefore = realConfigSnapshot();
    ran = true;
    const r = await runSession({ build: build.dir, project, home, prompt: meta.prompt, maxUsd: o.maxUsd, env, sessionModel });
    meta.exitCode = r.status;
    meta.wallMs = r.wallMs;
    meta.realConfig = compareSnapshots(configBefore, realConfigSnapshot(), tmp);
    meta.endedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'stdout.txt'), r.stdout);
    fs.writeFileSync(path.join(out, 'stderr.txt'), r.stderr);
    let result = null;
    try { result = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop()); } catch (e) { result = null; }
    if (result && typeof result.total_cost_usd === 'number') reportedCost = result.total_cost_usd;
    if (result) fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    sessionDone = true;
  } finally {
    stopServer(serverPid);
    copyDir(path.join(home, '.claude', 'projects'), path.join(out, 'transcripts'));
    copyDir(path.join(project, 'reports'), path.join(out, 'project-reports'));
    copyDir(path.join(project, 'plans'), path.join(out, 'project-plans'));
    if (fs.existsSync(path.join(project, 'artifacts', 'html', 'review.html'))) fs.copyFileSync(path.join(project, 'artifacts', 'html', 'review.html'), path.join(out, 'review.html'));
    if (fs.existsSync(path.join(project, '.git'))) {
      const st = sh('git', ['status', '--porcelain'], { cwd: project, env: GIT_ENV });
      const lg = sh('git', ['log', '--oneline', '-5'], { cwd: project, env: GIT_ENV });
      fs.writeFileSync(path.join(out, 'project-git.json'), JSON.stringify({ status: st.stdout, log: lg.stdout }, null, 2) + '\n');
    }
    fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true });
    // A run that broke after its session started still enters its spend.
    if (ran && !sessionDone) enterLedger(false);
  }
  let analysis = null;
  try {
    analysis = analyzeRun(loadRun(out), loadAnswers());
    fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
  } finally {
    enterLedger(!!analysis && analysis.valid);
  }
  printRunSummary(analysis);
  if (meta.realConfig) {
    const c = meta.realConfig;
    console.log('  real config: ' + (c.unchanged ? 'unchanged' : 'CHANGED: ' + c.changed.join(', ')) + (c.stampOnly.length ? ' (only an update-check stamp moved in ' + c.stampOnly.join(', ') + ')' : '')
      + ((c.otherSessions || []).length ? ' (another session of the owner\'s added lines to ' + c.otherSessions.join(', ') + '; none names this run)' : ''));
    if (!c.unchanged) { console.log('STOP: the real config changed during this run. Page the owner (M1) before any further run.'); process.exit(6); }
  }
  if (interrupted) { console.log('quality-check: interrupted; the run is entered in the ledger, and nothing reruns.'); process.exit(130); }
  if (role === 'probe') {
    const ok = probeVerdict(analysis, meta);
    console.log('probe ' + o.probe + ': ' + (ok.ok ? 'PASS' : 'FAIL') + (ok.why ? ' - ' + ok.why : ''));
    process.exit(ok.ok ? 0 : 5);
  }
  if (!analysis.valid) {
    console.log(analysis.reasons.includes('usage-limit')
      ? 'USAGE LIMIT: page the owner now (M1); do not rerun.'
      : 'INVALID: rerun once. A second invalid run pages the owner (M1).');
    process.exit(3);
  }
  // A valid review whose mode check failed: the catches stand, the routing does not.
  const failed = (analysis.checks || []).filter(c => !c.ok);
  if (failed.length) {
    console.log('MODE CHECK FAILED: ' + failed.map(c => c.name + ': ' + c.detail).join('; '));
    process.exit(5);
  }
}

function probeVerdict(a, meta) {
  if (!a.valid) return { ok: false, why: 'invalid run: ' + a.reasons.join(', ') };
  if (meta.probe === 'review') {
    if (!a.reportFile) return { ok: false, why: 'no report written' };
    return { ok: true, why: 'report at ' + path.relative(a.dir, a.reportFile) + '; ' + a.survivorCount + ' surviving, ' + a.killedCount + ' audited out' };
  }
  for (const [type, want] of Object.entries(meta.expect.byType || {})) {
    const got = (a.models.byType[type] || []).map(familyOf);
    if (got.length === 0) return { ok: false, why: type + ' was not dispatched' };
    if (got.some(f => f !== want)) return { ok: false, why: type + ' answered on ' + got.join('+') + ', want ' + want };
  }
  const failed = (a.checks || []).filter(c => !c.ok);
  if (failed.length) return { ok: false, why: failed.map(c => c.name + ': ' + c.detail).join('; ') };
  return { ok: true, why: [...Object.entries(meta.expect.byType || {}).map(([t, w]) => t + ' on ' + w), ...(a.checks || []).map(c => c.name + ': ' + c.detail)].join(', ') };
}

function money(x) { return typeof x === 'number' ? '$' + x.toFixed(2) : 'n/a'; }
function mins(ms) { return typeof ms === 'number' ? (ms / 60000).toFixed(1) + ' min' : 'n/a'; }

function printRunSummary(a, verbose) {
  console.log('');
  console.log('Run: ' + path.relative(REPO, a.dir));
  console.log('  valid: ' + (a.valid ? 'yes' : 'NO (' + a.reasons.join(', ') + ')') + (a.warnings.length ? '; warnings: ' + a.warnings.join(', ') : ''));
  console.log('  cost: ' + money(a.costUsd) + ', time: ' + mins(a.wallMs) + ', turns: ' + (a.turns || 'n/a'));
  if (a.models) console.log('  models: main ' + a.models.main.join('+') + '; ' + Object.entries(a.models.byType).map(([t, m]) => t.replace(/^tk:/, '') + ' ' + m.join('+')).join('; '));
  for (const c of a.checks || []) console.log('  check ' + c.name + ': ' + (c.ok ? 'ok' : 'FAILED') + ' - ' + c.detail);
  if (a.outside) console.log('  outside reads: ' + a.outside.join(' | '));
  if (a.survived) {
    console.log('  findings in report: ' + a.survivorCount + ' surviving, ' + a.killedCount + ' audited out; contract breaks: ' + a.contractBreaks + '; prose wrapped around JSONL: ' + (a.wrapped || 0));
    for (const id of Object.keys(a.survived)) {
      console.log('    ' + id.padEnd(26) + ' raised ' + String(a.raised[id].length).padEnd(2) + ' survived ' + (a.survived[id].length ? 'yes (' + a.survived[id].map(e => e.id).join(',') + ')' : 'no'));
      if (verbose) {
        for (const r of a.raised[id]) console.log('        raised [' + r.kind + '] ' + r.what);
        for (const e of a.survived[id]) console.log('        report ' + e.text);
      }
    }
    if (verbose) {
      console.log('  matched no planted bug (check by eye that none is a missed catch):');
      for (const r of a.unmatchedRaw) console.log('    raw [' + r.kind + '] ' + r.file + ' ' + r.what);
      for (const e of a.unmatchedSurvivors) console.log('    report ' + e.text);
    }
  }
  if (a.role === 'mapper' && a.mapper) console.log('  mapper: ' + JSON.stringify(a.mapper));
}

function commandScore(o) {
  const answers = loadAnswers();
  const load = list => list.split(',').map(s => s.trim()).filter(Boolean).map(d => analyzeRun(loadRun(path.resolve(d)), answers));
  const baseline = load(o.against);
  const role = baseline[0] && baseline[0].role;
  const ids = role === 'mapper'
    ? ((loadRun(path.resolve(o.against.split(',')[0])).meta.chunk || {}).files || [])
    : answers.bugs.map(b => b.id);
  const knownId = (answers.bugs.find(b => b.knownAnswer) || {}).id;
  const results = o.score.map(set => ({ set, s: scoreSets(load(set), baseline, ids, { knownId, requireKnown: o.requireKnown }) }));
  if (o.json) { console.log(JSON.stringify(results, null, 2)); return; }
  for (const { set, s } of results) {
    console.log('Candidate: ' + set);
    console.log('Baseline:  ' + o.against);
    console.log('  runs: baseline ' + s.baselineValid + '/' + s.baselineRuns + ' valid, candidate ' + s.candidateValid + '/' + s.candidateRuns + ' valid');
    for (const inv of s.invalid) console.log('  invalid: ' + path.relative(REPO, inv.dir) + ' (' + inv.reasons.join(', ') + ')');
    console.log('  stable (' + s.stable.length + '): ' + (s.stable.join(', ') || 'none'));
    if (s.noisy.length) console.log('  noisy, not scored (' + s.noisy.length + '): ' + s.noisy.join(', '));
    if (s.never.length) console.log('  never caught by the baseline (' + s.never.length + '): ' + s.never.join(', '));
    if (role !== 'mapper') {
      console.log('  ' + 'bug'.padEnd(26) + 'baseline  candidate  raised(candidate)');
      for (const [id, p] of Object.entries(s.perId)) console.log('  ' + id.padEnd(26) + p.baseline.padEnd(10) + p.candidate.padEnd(11) + p.raisedCandidate);
    }
    console.log('  cost per run: baseline ' + money(s.baselineCostUsd) + ', candidate ' + money(s.costUsd) + '; time: baseline ' + mins(s.baselineWallMs) + ', candidate ' + mins(s.wallMs));
    console.log('  VERDICT: ' + s.verdict + (s.why.length ? ' - ' + s.why.join('; ') : ''));
    console.log('');
  }
  const passing = results.filter(r => r.s.verdict === 'PASS' && typeof r.s.costUsd === 'number').sort((x, y) => x.s.costUsd - y.s.costUsd);
  if (results.length > 1) console.log('Cheapest passing set: ' + (passing.length ? passing[0].set + ' (' + money(passing[0].s.costUsd) + ' per run)' : 'none'));
}

function commandBudget() {
  const rows = ledger();
  const spent = rows.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const approval = readJson(BUDGET);
  for (const r of rows) console.log((r.at || '').slice(0, 19) + '  ' + String(r.role + (r.arm ? '-' + r.arm : '') + (r.probe ? '-' + r.probe : '')).padEnd(22) + String(r.build).padEnd(10) + (money(r.costUsd) + (r.costCapped ? '*' : '')).padEnd(9) + (r.valid ? 'valid' : 'INVALID') + '  ' + r.dir);
  if (rows.some(r => r.costCapped)) console.log('* no cost reported (a timeout, a crash, an interrupt): entered at the run\'s cap');
  console.log('spent: ' + money(spent) + '; approved: ' + (approval ? money(approval.approvedUsd) + ' (' + approval.at + ')' : 'none yet'));
}

function usage(msg) {
  if (msg) console.error('quality-check: ' + msg);
  console.error('usage: see the header of scripts/quality-check.js');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { score: [], maxUsd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(a + ' needs a value'); return argv[++i]; };
    if (a === '--role') o.role = val();
    else if (a === '--arm') o.arm = val();
    else if (a === '--build') o.build = val();
    else if (a === '--effort') o.effort = val();
    else if (a === '--chunk') o.chunk = val();
    else if (a === '--label') o.label = val();
    else if (a === '--max-usd') o.maxUsd = Number(val());
    else if (a === '--mode-word') o.modeWord = val();
    else if (a === '--plan-models') o.planModels = val();
    else if (a === '--keep') o.keep = true;
    else if (a === '--score') o.score.push(val());
    else if (a === '--against') o.against = val();
    else if (a === '--require-known') o.requireKnown = true;
    else if (a === '--json') o.json = true;
    else if (a === '--check') o.check = val();
    else if (a === '--probe') o.probe = val();
    else if (a === '--budget') o.budget = true;
    else if (a === '--approve') o.approve = Number(val());
    else usage('unknown argument ' + a);
  }
  return o;
}

async function main() {
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  const o = parseArgs(process.argv.slice(2));
  if (o.budget) return commandBudget();
  if (o.approve !== undefined) {
    if (!(o.approve > 0)) usage('--approve needs a positive dollar amount');
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    fs.writeFileSync(BUDGET, JSON.stringify({ approvedUsd: o.approve, at: new Date().toISOString() }, null, 2) + '\n');
    console.log('approved budget recorded: ' + money(o.approve));
    return;
  }
  if (o.check) {
    const a = analyzeRun(loadRun(path.resolve(o.check)), loadAnswers());
    fs.writeFileSync(path.join(path.resolve(o.check), 'analysis.json'), JSON.stringify(a, null, 2) + '\n');
    printRunSummary(a, true);
    process.exit(a.valid ? 0 : 3);
  }
  if (o.score.length) {
    if (!o.against) usage('--score needs --against <baseline runs>');
    return commandScore(o);
  }
  if (o.probe) {
    if (o.probe === 'browser' || o.probe === 'audit') return probeLocal(o);
    if (o.probe === 'models') {
      // Two sessions: the override, then inherit against the variable.
      for (const p of ['models-override', 'models-inherit']) {
        const child = spawnSync(process.execPath, [__filename, '--probe', p, '--build', o.build], { stdio: 'inherit' });
        if (child.status !== 0) process.exit(child.status);
      }
      return;
    }
    o.role = 'probe';
    o.maxUsd = o.maxUsd || PROBE_MAX_USD[o.probe] || DEFAULT_MAX_USD.probe;
    return commandRun(o);
  }
  if (!o.maxUsd) o.maxUsd = DEFAULT_MAX_USD[o.role] || DEFAULT_MAX_USD.review;
  return commandRun(o);
}

// The two preflight checks that need no Claude session: the browser script
// loads the changed page and sees its page error, and npm audit reports lodash.
async function probeLocal(o) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-probe.'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  fs.mkdirSync(home, { recursive: true });
  let serverPid = null;
  let ok = false;
  let why = '';
  try {
    buildReviewProject(project, null);
    if (o.probe === 'browser') {
      if (!o.build) usage('--probe browser needs --build');
      const build = prepareBuild(o.build, home, tmp);
      serverPid = await startServer(project);
      const env = sessionEnv(tmp, { HOME: home });
      const actions = JSON.stringify({ baseUrl: 'http://localhost:' + PORT, actions: [{ type: 'goto', url: '/' }, { type: 'wait', ms: 500 }, { type: 'text', target: 'css:#notes' }] });
      const r = sh(process.execPath, [path.join(home, '.claude', 'plugins', 'cache', 'llm-peer-review', 'tk', build.version, 'scripts', 'browse.js')], { input: actions, env, cwd: project });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
      const err = j && Array.isArray(j.errors) ? j.errors.map(e => e.text).join(' | ') : '';
      ok = !!j && j.title === 'Notebook' && /addEventListener/.test(err);
      why = j ? 'title ' + JSON.stringify(j.title) + ', page errors: ' + (err || 'none') : 'browse.js output was not JSON: ' + (r.stdout + r.stderr).slice(0, 300);
    } else {
      const r = sh('npm', ['audit', '--json'], { cwd: project, env: { ...process.env, HOME: home } });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
      const v = j && j.vulnerabilities && j.vulnerabilities.lodash;
      ok = !!v && /high|critical/.test(v.severity);
      why = v ? 'lodash ' + v.severity + ': ' + v.via.map(x => x.title || x).slice(0, 2).join('; ') : 'no lodash advisory: ' + (r.stdout + r.stderr).slice(0, 300);
    }
  } finally {
    stopServer(serverPid);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('probe ' + o.probe + ': ' + (ok ? 'PASS' : 'FAIL') + ' - ' + why);
  process.exit(ok ? 0 : 5);
}

module.exports = {
  familyOf, lowerEffort, frontmatterValue, patchAgent, parseFinderOutput, findingText, bugMatches, rawToMatchable,
  parseReport, entryMatches, linkRaw, normWords, parseMapperOutput, twinOf, mapperCoverage, toolPaths, digestRecords, analyzeRun,
  scoreSets, loadRun, copyFixture, fillMapperTemplate, mapperTemplate, armSettings, FINDER_KINDS, tokenWindowProblem,
  modeFamily, modeLineCheck, expectChecks, finderModels, probeVerdict, appendSource, compareSnapshots,
  runGroup, ledgerCost, LOOPBACK_PRELOAD,
};

if (require.main === module) {
  main().catch(e => { console.error('quality-check: ' + (e && e.stack || e)); process.exit(1); });
}
