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
//   --role review  A fixture (see Fixtures below) becomes a two-commit git repo
//                  (base, then a change that plants one bug per review lens plus
//                  a known-answer case), its dev server is started on 127.0.0.1
//                  port 3000 (the shared loopback.js keeps it off the network),
//                  and the session runs
//                  `/tk:review <all eight lenses> <base>..HEAD report only, no chaining`.
//   --role mapper  A git archive of a frozen source commit, and one dispatch of
//                  the index-mapper agent on a frozen chunk of it, with /index's
//                  Step 3 prompt template copied out of the build under test.
//   --role skeptic A replay of the one known judge-input drift, session 1cefa1a7
//                  (harness research plan Step 10): a git archive of the commit
//                  that run reviewed, its finders' lines taken from the session
//                  log, its saved receipts and scope, and the build's /tk:review
//                  entered at Phase 4 with dedup and tier 1 done, to run the
//                  skeptic tiers and stop before any fix. It has no arm: it
//                  measures the build's prompts as they ship. See "The skeptic
//                  replay" below.
//   --role fix     The review role's run (same fixture, scratch project, server,
//                  build install, cap, budget gate and token guard) without
//                  "report only", so /review's auto-fix loop runs, and with "no
//                  chaining", so it stops after the loop instead of handing off to
//                  /document (harness research plan Step 11). It has no arm: the
//                  build's prompts as they ship. The scratch project's final tree
//                  is then judged by oracles the session never sees. See "The fix
//                  role and its oracles" below.
//
// Fixtures (#278). Each planted-bug fixture is a folder under
// scripts/fixtures/quality-check/<name>/ holding answers.json (the answer key),
// base/ and change/ (the two commits) and oracles/ (the fix role's oracles);
// loopback.js and oracle-lib.js, which every fixture shares, sit one level up and
// are copied beside the oracles at judge time. --fixture <name> chooses one for
// --role review, --role fix and --oracle-self-test; without it the fixture is
// notebook, and the mode probes, the mapper and the skeptic replay always run on
// notebook. An unknown name is refused with the list of folders that hold an
// answers.json. A fixture's hash is taken over its base/ and change/ files by
// their paths inside its own folder, so moving the folder does not move it. The
// answer key also holds what used to be constants here: `app` (the app's name and
// the two commit messages), `selfTestPair`, and `noOracle` on each bug no script
// can run.
//
// Notebook chooses, Pocket judges (#278, the held-out rule). Prompt wording, model
// pins and every other setting are tuned on notebook. pocket is held out as the
// judge: a pocket run may correct pocket's own answer key (every saved pocket run
// rescored with --check and the moved catches reported), but nothing is ever
// tuned on a pocket result, never a prompt, a model pin or notebook's key. A
// pocket miss on the current build is filed as an issue and worked on notebook,
// and pocket is run again only to re-judge.
//
// The arm decides the measured agents' model and effort, patched into the
// build's agent files before the session starts (never into the repo):
//
//   a     the session model (Opus) at the role's current effort; the mapper at
//         medium, because its shipped low is the setting under suspicion
//   b     the session model one effort level lower (the mapper at low)
//   c     Sonnet at the decided effort, given with --effort
//   h     Haiku at the decided effort (medium when --effort is not given). With
//         --only <agent[,agent]> only the named agents are patched and the rest
//         ship as the build has them, so one helper can be measured on its own
//         (issue 221, the per-helper A/B receipts)
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
// refused would score the refusal), no MCP servers, the page-publishing and web
// tools removed (DISALLOWED_TOOLS: the fixture's answer key is tracked in a
// public repository, so a session may not fetch it, #277), key-like variables
// stripped from the environment (stripSecrets: names ending _KEY, _SECRET,
// _PASSWORD, _TOKEN or _ACCESS_KEY_ID, except the session's own CLAUDE_CODE_*
// and the GitHub CLI's GH_TOKEN and GITHUB_TOKEN, which the dependency lens may
// need; the network itself stays on for that lens, so a shell fetch is warned
// on by the analyzer, never blocked), and a
// PATH shim that turns the Windows browser launchers into no-ops, so a run
// neither publishes a page nor opens a window. What a run ran under is recorded
// in run.json as meta.restrictions (the tools, the stripped names, the entries
// of /tmp at session start) and printed in its summary, so a result can say what
// it was measured under. Each run has a dollar cap
// (--max-usd), and the whole measurement has one approved budget (see Budget).
//
// Usage:
//   node scripts/quality-check.js --role review --arm <a|b|c|h|ship> [--only <agent[,agent]>] --build <git-ref|tree>
//        [--effort <level>] [--max-usd <n>] [--label <text>] [--mode-word <best|fit|cheap>]
//        [--plan-models <best|fit|cheap>] [--fixture <name>] [--keep]
//   node scripts/quality-check.js --role mapper --arm <a|b|c|h|ship> [--only <agent[,agent]>] --build <git-ref|tree>
//        --chunk <manifest.json> [--effort <level>] [--max-usd <n>] [--keep]
//   node scripts/quality-check.js --role skeptic --build <git-ref|tree> [--evidence <dir>] [--receipts <dir>]
//        [--max-usd <n>] [--label <text>] [--keep]
//        --evidence is the folder holding the 1cefa1a7 session log (default: the main
//        checkout's reports/harness-papers-2026-10-12/evidence), --receipts that run's
//        receipts folder (default: the main checkout's reports/receipts/2026-09-22-002749)
//   node scripts/quality-check.js --role fix --build <git-ref|tree> [--max-usd <n>] [--label <text>]
//        [--oracle-port <n>] [--fixture <name>] [--keep]
//        --oracle-port is where the oracles start the judged tree's server after the
//        session (default 3000, which the session's own fixture server has freed by then)
//   node scripts/quality-check.js --judge <fix-run-dir> [--oracle-port <n>]   re-run the
//        oracles on a saved fix run's final tree (no session, no cost)
//   node scripts/quality-check.js --oracle-self-test [--oracle-port <n>] [--fixture <name>]   the
//        oracles on the change tree unfixed, then with hand-made correct and empty fixes (no
//        session; a free port other than 3000 unless --oracle-port names one)
//   node scripts/quality-check.js --score <run[,run...]> [--score <run[,run...]>]
//        --against <run[,run...]> [--require-known] [--allow-drift <reason>] [--pool <dir>] [--json]
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
// Each run lands in reports/quality-check/<stamp>-<role>-<arm>-<build>[-<fixture>][-<label>]/,
// the fixture named only when it is not notebook: run.json (what ran, the fixture's
// hash and name as meta.fixture and meta.fixtureName), result.json (the session's
// own JSON result), transcripts/ (every session and helper transcript),
// project-reports/ (the review's markdown report and receipts), analysis.json
// (validity and catches), and a line in reports/quality-check/ledger.jsonl that
// names the fixture too. reports/ is gitignored and kept on disk. --check, --judge
// and --score read the fixture from each run's record (a run saved before #278 has
// none and ran on notebook), so they take no --fixture; --score refuses runs of
// two fixtures, and its noise pool holds only runs of the fixture it scores.
// A skeptic run adds replay-merge/ (the Phase 3 merge folder it was handed) and
// scratchpad/ (the session's scratchpad, where a runner may write shards with
// Bash, so no transcript holds their bytes). A fix run adds project-final/ (the
// scratch project as the session left it, without .git, reports/ and artifacts/),
// fix-diff.patch (git diff from the planted change to that tree, untracked files
// included) and oracles.json (each oracle's verdict on project-final/).
//
// A run is INVALID, and is rerun once, when: the session did not end cleanly
// (non-zero exit, an error result, a turn or budget stop), it hit a usage limit,
// any session or helper answered on a model other than the one it should have,
// any call was denied (except a read-only judge's scratch experiment, which is the
// warning denied-experiment:<n>; scratchExperiment says exactly which), a review
// lens was not dispatched, a finder or the mapper
// returned nothing, the review wrote no report, the mapper dispatch did not carry
// the expected prompt, a skeptic replay made no skeptic dispatch, or a tool read
// outside the scratch project, the scratch
// home (which holds the plugin build and the stable plugin path) and /tmp. A
// second invalid run, or a usage limit, pages the owner (M1). Three leak paths
// are warnings, not reasons (#277): network-name (a Bash call naming github.com
// or githubusercontent.com, where the fixture's answer key is public, or a
// GitHub CLI call naming this repository, an answer-key file or a contents
// endpoint), plugin-read (a finder's or judge's read of the build's
// skills/shared/model-routing.md, the shipped file that describes the
// known-answer bug, or a search of a folder under the scratch home that holds
// it) and stale-tmp (a read under a /tmp entry that existed at session start,
// other than the run's own tmp and home); each sees a path reached through a
// shell command as well as through a tool. The first real runs show how often
// each fires before any is promoted to a reason.
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
//   - One thing moves per comparison (research plan item 2, P1-C1). Each run's
//     setting is printed: a harness line (the build, as a hash of the plugin files
//     the measured path reads; the session's model and effort; the Claude Code
//     version; the fixture; for the mapper, the dispatch prompt's hash from the
//     saved transcript and the chunk) and an arm line (each measured agent's model
//     and effort). Each set must be uniform, and between the two sets either the
//     arm moves with the harness held (a model A/B) or the build moves with the arm
//     held (a harness A/B). Anything else is CONFOUNDED, naming the fields that
//     differ, and only --allow-drift <reason> scores it anyway, printing the reason.
//     A field a saved run cannot supply prints as unknown and never counts as a
//     difference, so CONFOUNDED rests on recorded differences only.
//   - A noise line per stable bug: how often the baseline's setting caught it across
//     every saved valid run on that setting (under --pool, reports/quality-check by
//     default). A FAIL on a bug that setting itself drops is marked weak.
//   - Harness-lost (P1-C2). A planted bug that was raised and then killed is
//     sorted by its Audited out line alone: refused (RECEIPT FAILED because the
//     runner refused the check, so it never ran), refuted (a skeptic or the vote),
//     or failed (the check ran and did not show the claim). A refused kill is
//     harness-lost: that run is left out of the bug's miss count, the way an
//     INVALID run is left out of the whole score, and a bug harness-lost in two
//     runs gives HARNESS (fix the runner, then rerun) instead of failing the arm.
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
// The planted-bug fixtures, one folder each, chosen with --fixture (#278): each
// <name>/ holds answers.json, base/, change/ and oracles/. What they share sits
// here, one level up: loopback.js and the oracles' generic half, oracle-lib.js.
const FIXTURES_ROOT = path.join(REPO, 'scripts', 'fixtures', 'quality-check');
const DEFAULT_FIXTURE = 'notebook';
const LOOPBACK_PRELOAD = path.join(FIXTURES_ROOT, 'loopback.js');
const ORACLE_LIB = path.join(FIXTURES_ROOT, 'oracle-lib.js');
const HARNESS = path.join(REPO, 'scripts', 'setup', 'headless-session.sh');
const OUT_ROOT = path.join(REPO, 'reports', 'quality-check');
const LEDGER = path.join(OUT_ROOT, 'ledger.jsonl');
const BUDGET = path.join(OUT_ROOT, 'budget.json');
const REAL_HOME = os.homedir();
const NODE_MODULES = path.join(REPO, '.claude', 'scripts', 'node_modules');
// This checkout's merge-findings.js: the skeptic replay checks every skeptic's
// return with its checkVerdicts, whatever build the session ran.
const MERGE_FINDINGS = path.join(REPO, '.claude', 'scripts', 'merge-findings.js');

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODES = ['best', 'fit', 'cheap'];
const FINDER_KINDS = ['code', 'security', 'ux', 'plan', 'commands', 'browser', 'deps', 'copy'];
const SESSION_MODEL = 'opus';
const SESSION_EFFORT = 'high';
const PORT = 3000;
const SESSION_TIMEOUT_MS = 90 * 60 * 1000;
// A stopped group gets SIGTERM, then SIGKILL for whatever is still running this long after.
const KILL_GRACE_MS = 10 * 1000;
// The skeptic replay takes the review role's cap: it runs the same orchestrator
// over a whole audit, without the finders. The fix role runs that whole review
// (measured at $4.19 to $6.11 on this fixture, 2026-10-03 to 10-05) and then the
// auto-fix loop over its 12 to 20 survivors: an edit, a re-check or a fix-verifier
// shard per finding and a digest, so about two to three times the review's turns,
// $12 to $18 expected. $40 is a little over twice the high end, so a slow loop is
// not stopped mid-fix by its own cap.
const DEFAULT_MAX_USD = { review: 25, mapper: 8, skeptic: 25, fix: 40, probe: 5 };
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
// session family. role is the agent's name: best leaves the map helper on its
// file's model, as fit does (#208, BEST_KEEPS_FILE_MODEL in session-init.js).
const BEST_KEEPS_FILE_MODEL = ['index-mapper'];
function modeFamily(mode, agentText, sessionFamily, role) {
  if (mode === 'best' && !BEST_KEEPS_FILE_MODEL.includes(role)) return sessionFamily;
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
// Each entry also keeps `head`, its own entry line, which is where an Audited out
// entry carries its verdict and the reason for it (auditVerdict).
function parseReport(md) {
  const lines = String(md || '').split(/\r?\n/);
  const survivors = new Map();
  const killed = new Map();
  const refRe = /`?([A-Za-z0-9_.\/-]*[A-Za-z0-9_-]\.[A-Za-z0-9]+)(?::(\d+))?`?/g;
  const entryOf = (map, id) => {
    if (!map.has(id)) map.set(id, { id, refs: [], text: '', evidence: '', split: '', head: '' });
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
      if (!entryOf(map, current.id).head) entryOf(map, current.id).head = line;
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

// An Audited out line's verdict and why it killed the finding (research plan item
// 3, P1-C2): { verdict, category, reason }. REFUTED, with or without a tally, is
// refuted: a skeptic or the vote judged it. RECEIPT FAILED is refused when the
// reason says the runner refused the check, which therefore never ran (the form
// report-format.md fixes since 7.6.3 is "refused: <reason>, so the claim was not
// tested"; run 2026-10-09-182657 wrote "the check was refused by the read-only
// check filter"); any other RECEIPT FAILED is failed: the check ran and its output
// did not show the claim, as when a check "could not run" because a folder it
// made was denied (cb6eee1 R13). The reason is the line's last parenthesized text
// after the verdict, where the report puts it, with parentheses inside a code span
// ignored; the finding's own sentence before it is never read for the word, so a
// finding about a refusal keeps the category its verdict gives. A line with no
// verdict tag is 'unknown'.
function auditVerdict(line) {
  const text = String(line || '');
  const tag = /`(RECEIPT FAILED|REFUTED(?: \d\/\d)?)`/i.exec(text);
  if (!tag) return { verdict: null, category: 'unknown', reason: '' };
  const after = text.slice(tag.index + tag[0].length);
  const groups = [];
  let depth = 0;
  let inCode = false;
  let cur = '';
  for (const ch of after) {
    if (ch === '`') inCode = !inCode;
    if (!inCode && ch === '(') { if (depth > 0) cur += ch; depth++; continue; }
    if (!inCode && ch === ')' && depth > 0) {
      depth--;
      if (depth === 0) { groups.push(cur); cur = ''; } else cur += ch;
      continue;
    }
    if (depth > 0) cur += ch;
  }
  // A group the line never closed still holds the reason that opened it.
  if (depth > 0 && cur) groups.push(cur);
  const reason = (groups.length ? groups[groups.length - 1] : after).trim();
  const verdict = tag[1].toUpperCase();
  const category = /^REFUTED/.test(verdict) ? 'refuted' : /\brefus/i.test(reason) ? 'refused' : 'failed';
  return { verdict, category, reason: reason.slice(0, 240) };
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
// the session's working folder; a shell command contributes paths under a user
// home or a Windows mount, the places a scratch run has no business in, and
// under /tmp, so the leak flags (#277) see a read made through the shell too.
function toolPaths(name, input, cwd) {
  const out = [];
  if (!input || typeof input !== 'object') return out;
  const add = p => { if (typeof p === 'string' && p.trim() !== '') out.push(path.resolve(cwd, p)); };
  if (name === 'Read' || name === 'NotebookRead') add(input.file_path || input.notebook_path);
  else if (name === 'Grep' || name === 'Glob' || name === 'LS') { add(input.path); if (name === 'Glob' && typeof input.pattern === 'string' && input.pattern.startsWith('/')) add(input.pattern.replace(/[*?[{].*$/, '')); }
  else if (name === 'Bash' && typeof input.command === 'string') {
    const re = /(?:^|[\s'"=:(<>|])((?:\/home|\/mnt|\/root|\/Users|\/tmp)\/[^\s'"|;&)<>]*)/g;
    let m;
    while ((m = re.exec(input.command)) !== null) out.push(m[1]);
  }
  return out;
}

function isUnder(p, root) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// A read-only judge's denied scratch experiment (#253). Audit skeptics and fix
// verifiers have no edit tools, yet they still try shell experiments, and Claude
// Code denies them; that denial comes from the runtime, not the build under test,
// so it is a warning rather than a reason to throw the run away. The call never
// ran, so this decides scoring, not safety, and it stays narrow: a Bash call by an
// audit-skeptic or fix-verifier counts only when it names at least one absolute
// path, every absolute path it names is /dev/null or lies inside the run (its temp
// folder, which holds the scratch project and home, or its scratchpad,
// /tmp/claude-<uid>/<project slug>/), and it has none of the shapes that can reach
// outside without naming a path: a `..` path step wherever it sits, `$d../x`
// included (an ellipsis is not one: the fix-d3 verifier's call has "sorts..."),
// `~`, a backtick, a backslash, eval, a bare `cd`, `cd -`, pushd or popd, an
// indirect `${!x}`, a variable the command does not itself set to a value, or a
// command that turns the working folder into a path (pwd, dirname, realpath,
// readlink). `$(...)` is allowed: its own text is checked like the rest. This is
// a best-effort filter over shell text, not a parser: it is built to keep the
// shapes the real judges used and refuse the escapes found so far, and a new
// escape gets a new shape and a test. toolPaths is not reused, because its Bash
// branch sees only /home, /mnt, /root and /Users, so /etc/passwd would read as
// inside.
const JUDGE_TYPE_RE = /^(tk:)?(audit-skeptic|fix-verifier)$/;
const ESCAPE_SHAPES = [/(^|[^.])\.\.($|[^.\w-])/, /~/, /`/, /\\/, /\beval\b/, /\$\{!/, /\b(pushd|popd)\b/, /\bcd(\s+-)?\s*($|[;&|)\n])/, /\b(pwd|dirname|realpath|readlink)\b/];
function scratchExperiment(type, call, paths) {
  if (!JUDGE_TYPE_RE.test(type || '') || !call || call.name !== 'Bash') return false;
  const raw = call.input && call.input.command;
  if (typeof raw !== 'string' || !paths || !paths.tmp || !paths.project) return false;
  if (ESCAPE_SHAPES.some(re => re.test(raw))) return false;
  // Quotes only group words, so drop them: /e''tc/passwd is /etc/passwd.
  const cmd = raw.replace(/['"]/g, '');
  // A variable counts as set when the command assigns it a value at the start of a
  // command (after a separator, `do`, `then` or `else`), or names it in `for x in`.
  const set = new Set();
  for (const m of cmd.matchAll(/(?:^|[\n;&|({]|\bdo|\bthen|\belse)\s*([A-Za-z_]\w*)\+?=(?=[^\s;&|)])/g)) set.add(m[1]);
  for (const m of cmd.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) set.add(m[1]);
  // $?, $#, $@, $0 to $9 and the like have no name, so they never match here.
  for (const m of cmd.matchAll(/\$\{?#?([A-Za-z_]\w*)/g)) if (!set.has(m[1])) return false;
  // An absolute path starts at a `/` that does not continue a word, a variable or a
  // relative path (`$d/x` and `backups/x` stay relative).
  const abs = [...cmd.matchAll(/(?:^|[^\w.}\-])(\/[^\s|;&)<>:,]*)/g)].map(m => path.resolve(m[1]));
  if (abs.length === 0) return false;
  const slug = paths.project.replace(/[^A-Za-z0-9]/g, '-');
  return abs.every(p => {
    if (p === '/dev/null' || isUnder(p, paths.tmp)) return true;
    const pad = /^\/tmp\/claude-(\d+)\//.exec(p);
    return !!pad && isUnder(p, '/tmp/claude-' + pad[1] + '/' + slug);
  });
}

// The transcript records' tool calls, models, texts and denials, flattened.
function digestRecords(records) {
  const d = { models: [], toolUses: [], texts: [], errors: [], denials: [], handback: null, lastText: '' };
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
        if (DENIED_RE.test(t)) {
          d.errors.push('denied: ' + t.slice(0, 200));
          d.denials.push({ id: c.tool_use_id, text: t.slice(0, 200) }); // matched back to its call in analyzeRun
        }
      }
    }
  }
  return d;
}

// The analysis of one run, from its loaded pieces: validity, models, finder
// outputs and contract breaks, raw and surviving catches, or mapper coverage.
// The typed agents a run may dispatch: the finders, the judges, the mapper and
// the extractor. Any other type is an other-agent warning.
const ROSTER_TYPE_RE = /^(tk:)?(audit-skeptic|fix-verifier|plan-critic|design-critic|design-comparer|decision-checker|correction-extractor|review-[a-z]+-finder|index-mapper)$/;

// The run summary's lines for the three leak lists (#277); none when none fired.
function leakLines(a) {
  const out = [];
  if (a.network && a.network.length) out.push('network: ' + a.network.join(' | '));
  if (a.pluginReads && a.pluginReads.length) out.push('plugin reads: ' + a.pluginReads.join(' | '));
  if (a.staleTmp && a.staleTmp.length) out.push('stale tmp reads: ' + a.staleTmp.join(' | '));
  return out;
}

function analyzeRun(run, answers) {
  const meta = run.meta || {};
  const result = run.result || null;
  const reasons = [];
  const warnings = [];
  const expect = meta.expect || {};
  const a = { dir: run.dir, role: meta.role, arm: meta.arm, label: meta.label || '', fixtureName: runFixtureName(meta), valid: true, reasons, warnings };
  // What the session ran under (#277); a run saved before the record has none.
  a.restrictions = meta.restrictions || null;

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
  // A denial in a transcript makes the run invalid, except a read-only judge's denied
  // scratch experiment (scratchExperiment, #253), which is counted as a warning. One
  // other denial still invalidates the whole run.
  let experiments = 0;
  let otherDenials = 0;
  for (const s of [{ type: 'main', d: main }, ...subs.map(x => ({ type: (x.meta && x.meta.agentType) || '', d: x.d }))]) {
    for (const den of s.d.denials) {
      const call = s.d.toolUses.find(t => t.id === den.id);
      if (scratchExperiment(s.type, call, meta.paths)) experiments++;
      else otherDenials++;
    }
  }
  if (otherDenials > 0) reasons.push('denied-in-transcript');
  if (experiments > 0) warnings.push('denied-experiment:' + experiments);

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
    else if (!ROSTER_TYPE_RE.test(type)) warnings.push('other-agent:' + type);
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

  // The three leak paths (#277), warnings rather than reasons: the first real
  // runs show how often each fires before any of them voids a run.
  //   network-name: a Bash call that names GitHub, where the fixture's answer key
  //                 is public (harness2's own validation run saw a rollout fetch
  //                 its rubric unprompted), or a GitHub CLI call that names this
  //                 repository, an answer-key file or a contents endpoint: the
  //                 same fetch by a road that names no domain (review, R13). A
  //                 CLI call about some other repository, the dependency lens's
  //                 own, is not flagged.
  //   plugin-read:  a finder's or judge's read of the one shipped file that
  //                 describes the known-answer bug, or a search scoped to a
  //                 folder under the scratch home that holds it (review, R11).
  //                 Only subagents count: the main session's own includes
  //                 resolve to the plugin folder, and the judges quote the loop
  //                 rules file from there by design.
  //   stale-tmp:    a read under a /tmp entry that existed at session start
  //                 (meta.restrictions.tmpBefore), other than the run's own tmp
  //                 and home, which exist before the session too. An entry
  //                 matches at a path-segment boundary only, so `foo` never
  //                 flags `foo-2`. A run recorded before the snapshot has no
  //                 list and gets no flag.
  // All three see a path reached through a shell command as well as through a
  // tool, since toolPaths yields /tmp paths from Bash (review, R11).
  const NETWORK_RE = /\b(?:[a-z0-9-]+\.)*github\.com\b|githubusercontent\.com/i;
  const GH_CLI_RE = /\bgh\s+(?:api|repo|gist)\b/;
  const repoName = path.basename(REPO);
  const namesThisRepo = cmd => cmd.includes(repoName) || /answers\.json|\/contents\//.test(cmd);
  const buildDir = meta.paths && meta.paths.buildDir;
  const home = meta.paths && meta.paths.home;
  const routingFile = buildDir ? path.join(buildDir, 'skills', 'shared', 'model-routing.md') : null;
  const coversRoutingFile = p => p === routingFile || (!!home && isUnder(p, home) && isUnder(routingFile, p));
  const before = meta.restrictions && Array.isArray(meta.restrictions.tmpBefore) ? meta.restrictions.tmpBefore : null;
  const own = [meta.paths && meta.paths.tmp, home].filter(Boolean);
  const network = [];
  const pluginReads = [];
  const staleTmp = [];
  for (const s of [{ sub: false, type: 'main', d: main }, ...subs.map(x => ({ sub: true, type: (x.meta && x.meta.agentType) || '', d: x.d }))]) {
    const typed = s.sub && ROSTER_TYPE_RE.test(s.type);
    for (const t of s.d.toolUses) {
      const cmd = t.name === 'Bash' && t.input && typeof t.input.command === 'string' ? t.input.command : null;
      if (cmd !== null && (NETWORK_RE.test(cmd) || (GH_CLI_RE.test(cmd) && namesThisRepo(cmd)))) network.push(cmd.trim().slice(0, 160));
      for (const p of toolPaths(t.name, t.input, cwd)) {
        if (typed && routingFile && coversRoutingFile(p)) pluginReads.push(p);
        if (before && isUnder(p, '/tmp') && !own.some(r => isUnder(p, r))) {
          const rel = path.relative('/tmp', p);
          if (before.some(e => rel === e || rel.startsWith(e + path.sep))) staleTmp.push(p);
        }
      }
    }
  }
  if (network.length) { warnings.push('network-name:' + network.length); a.network = network.slice(0, 20); }
  if (pluginReads.length) { warnings.push('plugin-read:' + pluginReads.length); a.pluginReads = [...new Set(pluginReads)].slice(0, 20); }
  if (staleTmp.length) { warnings.push('stale-tmp:' + staleTmp.length); a.staleTmp = [...new Set(staleTmp)].slice(0, 20); }

  // Cost, tokens, time.
  a.costUsd = result && typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null;
  a.wallMs = meta.wallMs || (result && result.duration_ms) || null;
  a.tokens = result && result.usage ? result.usage : null;
  a.modelUsage = result && result.modelUsage ? result.modelUsage : null;
  a.turns = result && result.num_turns;

  if (meta.role === 'probe') a.probe = meta.probe || null;
  if (meta.role === 'review' || meta.role === 'fix' || (meta.role === 'probe' && meta.probe === 'review')) analyzeReview(a, run, subs, answers, reasons, warnings);
  else if (meta.role === 'mapper') analyzeMapper(a, run, main, subs, reasons);
  else if (meta.role === 'skeptic') analyzeSkeptic(a, run, main, subs, reasons, warnings);
  if (meta.role === 'fix') analyzeFix(a, run, subs, answers, warnings);

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
  // Why each raised-then-killed bug was killed (P1-C2), from its Audited out
  // entries only: the ones its raw findings were formatted into, else the ones
  // whose own words match it (an entry the orchestrator reworded). An Audited out
  // line names no file, so that second look matches the bug's words alone, and
  // only on an entry whose lens tag ([code, ux]) names a finder that raised the
  // bug, which keeps another lens's kill from being taken for it. Survivors are
  // never read for this, so a standing finding whose sentence says "refused"
  // (cb6eee1 R19) is never a refusal. A bug is harness-lost only when every
  // entry that killed it was refused: one a skeptic refuted, or whose check ran
  // and failed, was lost on its merits. A raised bug no Audited out entry carries
  // is 'unlinked' and stays an ordinary miss.
  a.killedAs = {};
  a.harnessLost = [];
  for (const b of bugs) {
    if (!a.killedRaised[b.id]) continue;
    let entries = rep.killed.filter(e => a.killedVia[b.id].includes(e.id));
    if (entries.length === 0) entries = rep.killed.filter(e => entryMatches(b, e));
    if (entries.length === 0) {
      const raisers = new Set(a.raised[b.id].map(r => r.kind));
      entries = rep.killed.filter(e => {
        const tag = /\*\*R\d+\*\*\s*\[([^\]]+)\]/.exec(e.head || '');
        const lenses = tag ? tag[1].split(',').map(x => x.trim().toLowerCase()) : [];
        return lenses.some(l => raisers.has(l)) && (b.match || []).some(all => all.every(re => new RegExp(re, 'i').test(e.text)));
      });
    }
    const kills = entries.map(e => ({ id: e.id, ...auditVerdict(e.head) }));
    let category = 'unlinked';
    if (kills.length && kills.every(k => k.category === 'refused')) category = 'refused';
    else if (kills.some(k => k.category === 'refuted')) category = 'refuted';
    else if (kills.some(k => k.category === 'failed')) category = 'failed';
    else if (kills.length) category = 'unknown';
    a.killedAs[b.id] = { category, kills };
    if (category === 'refused') a.harnessLost.push(b.id);
  }
  const counted = new Set(Object.values(a.survived).flat().map(e => e.id));
  for (const e of rep.survivors) if (!counted.has(e.id)) a.unmatchedSurvivors.push({ id: e.id, text: short(e) });
  for (const r of raws) if (r.hits.length === 0) a.unmatchedRaw.push({ kind: r.kind, file: r.file, what: r.what.slice(0, 160) });
  // A fix run is meant to change the project; a report-only run is not.
  if ((run.meta || {}).role !== 'fix' && run.projectGit && /^\s*[MADRC?]/m.test(run.projectGit.status || '')) warnings.push('project-changed');
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

// ---------------------------------------------------------------------------
// The skeptic replay (harness research plan Step 10, D2)
// ---------------------------------------------------------------------------
//
// Session 1cefa1a7 is the one known judge-input drift (the evidence folder's
// README, plan Step 1): at its Phase 4 audit the /review orchestrator wrote its
// own skeptic shards, paraphrased all 16 findings, sent no receipt output, and
// asked the skeptics for KEEP or KILL in place of M2's words. --role skeptic puts
// a fresh session at that same point, with that run's own inputs, on the build
// under test, and then reads back what each skeptic dispatch carried and what
// came back. The run's inputs are read from the evidence at run time and never
// copied into the repo: the session log is local-only (the README's privacy note).
//
// The fixed facts, from the README. firstDispatch is the drift's first
// audit-skeptic call (log line 1128); the finder wave is every finder dispatch
// between the judge call before it and that call. keyMerges is the run's one
// judgment merge (its report: "two merged at pre-push-check.js:530"), which Phase
// 3 makes by giving the later line the earlier line's key before merge-findings.js
// runs. raw and merged are the report's counts, checked before a session starts.
const SKEPTIC_REPLAY = {
  session: '1cefa1a7-7fd0-4d50-adff-32d1b619b83c',
  firstDispatch: 'toolu_01S1c7UTdhrREGzJocx5VwF5',
  evidence: 'reports/harness-papers-2026-10-12/evidence',
  receipts: 'reports/receipts/2026-09-22-002749',
  keyMerges: [{ relPath: '.claude/scripts/pre-push-check.js', line: 530 }],
  raw: 17,
  merged: 16,
};
// The judges a skeptic replay scores: the typed skeptic, and its general-purpose fallback.
const SKEPTIC_TYPE = /^(tk:)?audit-skeptic$/;
// M2's skeptic verdict words (tiers 2 and 3); a request for any other word is the drift.
const M2_SKEPTIC_WORDS = ['REFUTED', 'STANDS', 'DOWNGRADE'];
// A tier 1 output file in a receipts folder (<lens>-<n>.txt), never a shard.
const RECEIPT_FILE = /^[a-z][a-z-]*-\d+\.txt$/;

// A hand-back message's report, as the subagent wrote it: the lines after the
// harness's "[Subagent hand-back]" frame line, the agent-message tags dropped,
// and the two spaces the harness indents every report line with removed.
function handbackBody(text) {
  const lines = String(text || '').split(/\r?\n/);
  const frame = lines.findIndex(l => /^\[Subagent hand-back\]/.test(l));
  return (frame === -1 ? lines : lines.slice(frame + 1))
    .filter(l => !/^<\/?agent-message\b[^>]*>\s*$/.test(l))
    .map(l => (l.startsWith('  ') ? l.slice(2) : l))
    .join('\n');
}

// Each agent's return in a session log, by agentId: { at, text } of the first
// record carrying it. A return reaches the log three ways (all three in 1cefa1a7):
// a user message with an origin, an attachment with one, or a queue entry that
// wraps it in <agent-message from="...">.
function agentReturns(records) {
  const out = new Map();
  records.forEach((r, at) => {
    if (!r || typeof r !== 'object') return;
    let from = null;
    let text = null;
    const origin = r.type === 'attachment' && r.attachment ? r.attachment.origin : r.origin;
    if (origin && typeof origin.body === 'string' && (origin.senderTaskId || origin.from)) {
      from = origin.senderTaskId || origin.from;
      text = origin.body;
    } else if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string') {
      const m = /<agent-message from="([^"]+)">/.exec(r.content);
      if (m) { from = m[1]; text = r.content; }
    }
    if (from && !out.has(from)) out.set(from, { at, text });
  });
  return out;
}

// The finder lines a session's audit was run over, from its log: the finder
// dispatches between the judge call before `firstDispatch` and that call, and
// each one's JSONL lines exactly as its report holds them (trimmed, the way
// merge-findings.js reads a line), in the order the returns arrived, which is
// the order the runner collected them in. Throws when the call is missing, the
// wave is empty, a finder returned nothing before the audit, or the harness
// neutralized a tag inside a finding line (its bytes could not be recovered).
function finderLinesFromLog(records, firstDispatch) {
  const calls = [];
  const agentOf = new Map();
  records.forEach((r, at) => {
    const content = r && r.message && Array.isArray(r.message.content) ? r.message.content : [];
    if (r && r.type === 'assistant') {
      for (const c of content) if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) calls.push({ at, id: c.id, type: String((c.input || {}).subagent_type || '') });
    } else if (r && r.type === 'user' && r.toolUseResult && r.toolUseResult.agentId) {
      for (const c of content) if (c.type === 'tool_result') agentOf.set(c.tool_use_id, r.toolUseResult.agentId);
    }
  });
  const target = calls.find(c => c.id === firstDispatch);
  if (!target) throw new Error('the session log has no Agent call ' + firstDispatch);
  const before = calls.filter(c => c.at < target.at);
  const lastJudge = before.filter(c => /(^|:)(audit-skeptic|fix-verifier)$/.test(c.type)).pop();
  const wave = before.filter(c => /(^|:)review-[a-z]+-finder$/.test(c.type) && (!lastJudge || c.at > lastJudge.at));
  if (!wave.length) throw new Error('no finder dispatch between the judge call before ' + firstDispatch + ' and it');
  const returns = agentReturns(records);
  const finders = wave.map(c => {
    const agentId = agentOf.get(c.id) || null;
    const ret = agentId ? returns.get(agentId) : null;
    if (!ret || ret.at > target.at) throw new Error(c.type + ' (' + c.id + ') returned nothing before ' + firstDispatch);
    const body = handbackBody(ret.text);
    const neutralized = /Control tags below are neutralized/.test(ret.text);
    const lines = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      let f = null;
      try { f = JSON.parse(t); } catch (e) { f = null; }
      if (!f || typeof f !== 'object' || typeof f.severity !== 'string' || typeof f.what !== 'string') continue;
      if (neutralized && t.includes('<\\')) throw new Error(c.type + ' (' + c.id + '): the harness neutralized a tag inside a finding line, so its bytes are not the finder\'s');
      lines.push(t);
    }
    return { agentId, type: c.type, toolUseId: c.id, at: ret.at, lines, noFindings: body.trim() === 'NO FINDINGS' };
  }).sort((x, y) => x.at - y.at);
  return {
    finders: finders.map(f => ({ agentId: f.agentId, type: f.type, toolUseId: f.toolUseId, count: f.lines.length, noFindings: f.noFindings })),
    lines: finders.flatMap(f => f.lines.map(text => ({ agentId: f.agentId, type: f.type, text }))),
  };
}

// Phase 3's one judgment merge, as review.md words it: of the lines that cite the
// same relPath and line, each later one is given the earliest one's `key`. Only
// the key's bytes change; the rest of each line stays as its finder wrote it.
// Returns { texts, notes }; throws when a merge does not find two lines.
function shareKeys(texts, merges) {
  const out = texts.slice();
  const notes = [];
  for (const m of merges || []) {
    const at = [];
    out.forEach((t, i) => {
      const f = JSON.parse(t);
      if (f.file && f.file.relPath === m.relPath && Number(f.file.line) === m.line) at.push(i);
    });
    if (at.length < 2) throw new Error('the merge at ' + m.relPath + ':' + m.line + ' found ' + at.length + ' line(s), not two or more');
    const key = JSON.parse(out[at[0]]).key;
    if (typeof key !== 'string') throw new Error('the first line at ' + m.relPath + ':' + m.line + ' carries no key');
    for (const i of at.slice(1)) {
      const old = JSON.parse(out[i]).key;
      const from = '"key":' + JSON.stringify(old);
      if (typeof old !== 'string' || out[i].split(from).length !== 2) throw new Error('line ' + (i + 1) + ' does not carry its key exactly once as ' + from);
      out[i] = out[i].replace(from, () => '"key":' + JSON.stringify(key));
    }
    notes.push({ relPath: m.relPath, line: m.line, key, lines: at.map(i => i + 1) });
  }
  return { texts: out, notes };
}

// `text` with the old project root replaced by the scratch project wherever it
// stands as a whole path (followed by a separator, a quote or the end), so a
// sibling folder that shares its prefix is left alone.
function rewriteRoot(text, from, to) {
  if (!from) return String(text);
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp(esc + '(?![A-Za-z0-9._-])', 'g'), () => to);
}

// The text of each tool result in a transcript, by tool_use id.
function toolResultTexts(records) {
  const out = new Map();
  for (const r of records || []) {
    const content = r && r.type === 'user' && r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const c of content) {
      if (c.type !== 'tool_result') continue;
      out.set(c.tool_use_id, typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : '');
    }
  }
  return out;
}

// The first line of `text` that parses as a JSON object, or null.
function jsonLine(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { return JSON.parse(t); } catch (e) { /* the next line */ }
  }
  return null;
}

// The files a `merge-findings.js --shards` call wrote, from its stdout:
// [{ file, tier, ids }], the tier 3 ballot included.
function shardsOutput(text) {
  const j = jsonLine(text);
  if (!j || !Array.isArray(j.shards)) return [];
  return j.shards.concat(j.tier3 ? [j.tier3] : [])
    .filter(s => s && typeof s.file === 'string' && Array.isArray(s.ids))
    .map(s => ({ file: s.file, tier: Number(s.tier) || 2, ids: s.ids }));
}

// The file paths a prompt names: tokens with a slash whose last part has an
// extension, trailing punctuation dropped. A citation with a line number
// (`a.js:12`) is a citation, not a file handed over, and is not returned.
function namedFiles(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\s"'`()<>[\]{},;]+/)) {
    const t = raw.replace(/[.:!?]+$/, '');
    if (!t.includes('/') || /^[a-z]+:\/\//i.test(t) || !/[^/]\.[A-Za-z0-9]{1,8}$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// The finding IDs a text names that `known` holds, ranges expanded ("R1 to R6",
// "R7-R11"), in number order.
function idsIn(text, known) {
  const s = String(text || '');
  const ids = new Set(s.match(/\bR\d+\b/g) || []);
  const range = /\bR(\d+)\s*(?:-|\u2013|\u2014|\.\.|to|through)\s*R?(\d+)\b/g;
  let m;
  while ((m = range.exec(s)) !== null) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi > lo && hi - lo < 200) for (let n = lo; n <= hi; n++) ids.add('R' + n);
  }
  return [...ids].filter(id => known.has(id)).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
}

// What a shard file tells its reader to do, without the bytes it carries: fenced
// blocks, JSON finding lines and the receipt-output sections merge-findings.js
// writes are dropped, so a verdict word quoted in a finding or a receipt is never
// read as one the shard asks for.
function instructionText(body) {
  const out = [];
  let fence = false;
  let receipt = false;
  for (const line of String(body || '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^Receipt output \(/.test(line)) { receipt = true; continue; }
    if (/^(Finding \(|Citation check:|=====)/.test(line)) receipt = false;
    // A finding's JSON line, or a line shaped like grep output (path:line: or, from
    // one file, line:), is quoted content: its verdict words were never asked for.
    if (receipt || /^\s*\{/.test(line) || /^(?:[\w.\/-]+:)?\d+:/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

// The verdict words a text asks for: the word after an ID and a colon,
// `R1: KEEP`, `RN: REFUTED`, the first word only.
function verdictAsks(text) {
  const re = /\bR(?:N|\d+|<N>)[*_`]*\s*:\s*[*_`]*([A-Z]{2,})\b/g;
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// A skeptic dispatch the replay scores: the typed skeptic, or a general-purpose
// call (M2's fallback) whose prompt names a finding ID or a skeptic's job.
function isSkepticDispatch(type, prompt) {
  if (SKEPTIC_TYPE.test(type)) return true;
  return type === 'general-purpose' && /\bR\d+\b|skeptic|refute/i.test(String(prompt || ''));
}

// One skeptic dispatch, scored from its prompt and what the session had written
// by then. ctx: { project, known: Map(id -> { severity, lines }), writes:
// Map(abs path -> content written with the Write tool), bash: [commands run],
// shards: Map(abs path -> { tier, ids }) from merge-findings.js --shards,
// readLocal(abs) -> the run folder's copy of a file, or null }. Every file the
// prompt names is read, except a project source file (a citation the skeptic may
// open, not an input handed over). The class is
//   script      the prompt names a file merge-findings.js --shards wrote
//   verbatim    every source line of every finding it covers is in the prompt or
//               a file it names, byte for byte
//   unknown     neither, and a file it names could not be read back
//   paraphrase  neither, and everything it names was read
// ids are the --shards file's, else the ones the prompt names, else the ones its
// files name. asks are the verdict words the prompt and its files' instruction
// lines ask for; m2Words is true when every one is M2's.
function scoreDispatch(prompt, ctx) {
  const project = ctx.project || '/';
  const known = ctx.known || new Map();
  const texts = [String(prompt || '')];
  // The prompt is filtered like a named file: verdict words inside quoted receipt
  // output or a pasted finding line are evidence, not words the runner asked for.
  const askTexts = [instructionText(prompt)];
  let script = null;
  let unreadable = false;
  let firstFile = null;
  for (const named of namedFiles(prompt)) {
    const abs = path.resolve(project, named);
    const shard = ctx.shards ? ctx.shards.get(abs) : null;
    if (shard && !script) script = { file: named, tier: shard.tier, ids: shard.ids };
    if (!shard && isUnder(abs, project) && !isUnder(abs, path.join(project, 'reports'))) continue;
    if (!firstFile) firstFile = named;
    let body = ctx.writes && ctx.writes.has(abs) ? ctx.writes.get(abs) : null;
    if (body === null && ctx.readLocal) body = ctx.readLocal(abs);
    const mentions = (ctx.bash || []).filter(c => c.includes(named) || c.includes(abs));
    if (body !== null) {
      texts.push(body);
      if (!RECEIPT_FILE.test(path.basename(abs)) && path.basename(abs) !== 'scope.json') askTexts.push(instructionText(body));
    } else if (!shard && !mentions.some(c => c.includes('<<'))) unreadable = true;
    texts.push(...mentions);
  }
  const fromPrompt = idsIn(prompt, known);
  const ids = script ? script.ids.filter(id => known.has(id)) : fromPrompt.length ? fromPrompt : idsIn(texts.slice(1).join('\n'), known);
  const all = texts.join('\n');
  const found = ids.filter(id => {
    const lines = (known.get(id) || {}).lines || [];
    return lines.length > 0 && lines.every(l => all.includes(l));
  });
  let asks = verdictAsks(askTexts.join('\n'));
  // A --shards file opens with M2's instruction for its tier by construction.
  if (script && asks.length === 0) asks = Number(script.tier) === 3 ? M2_SKEPTIC_WORDS.slice() : ['REFUTED', 'STANDS'];
  const tier = script ? Number(script.tier) : ids.length && ids.every(id => (known.get(id) || {}).severity === 'block') ? 3 : 2;
  let cls = 'paraphrase';
  if (script) cls = 'script';
  else if (ids.length && found.length === ids.length) cls = 'verbatim';
  else if (unreadable) cls = 'unknown';
  return { ids, tier, class: cls, file: script ? script.file : firstFile, linesFound: found.length, asks, m2Words: asks.length > 0 && asks.every(w => M2_SKEPTIC_WORDS.includes(w)) };
}

// The run folder's copy of a file the session wrote: under the project's
// reports/ (project-reports/), the replay's merge folder (replay-merge/), or the
// session's scratchpad, <tmp>/claude-<uid>/<project slug>/ (scratchpad/<slug>/).
function localCopyOf(abs, dir, meta) {
  const paths = (meta && meta.paths) || {};
  const replay = (meta && meta.replay) || {};
  if (paths.project && isUnder(abs, path.join(paths.project, 'reports'))) return path.join(dir, 'project-reports', path.relative(path.join(paths.project, 'reports'), abs));
  if (replay.mergeDir && isUnder(abs, replay.mergeDir)) return path.join(dir, 'replay-merge', path.relative(replay.mergeDir, abs));
  const m = /\/claude-\d+\/([^/]+)\/(.+)$/.exec(abs);
  return m ? path.join(dir, 'scratchpad', m[1], m[2]) : null;
}

// The verdict each finding was recorded with: the session's final message, one
// `RN: <verdict>` line per finding as the replay's prompt asks. { id: word }.
function recordedVerdicts(text, known) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^[\s>*_`-]*(R\d+)[*_`]*\s*:\s*[*_`]*\s*([A-Za-z][A-Za-z]*)/.exec(line);
    if (m && known.has(m[1]) && !out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

// The skeptic replay's analysis: each skeptic dispatch scored (scoreDispatch),
// its return checked with this checkout's merge-findings.js checkVerdicts, and
// which dispatch each recorded verdict came from (the last one whose return ruled
// on that ID, with a verdict word of any kind). A finding is ruled on from a
// paraphrase when that dispatch is a paraphrase; one recorded as unaudited was
// not ruled on.
function analyzeSkeptic(a, run, main, subs, reasons, warnings) {
  const meta = run.meta || {};
  const replay = meta.replay || {};
  const project = (meta.paths && meta.paths.project) || '/';
  const lines = replay.lines || [];
  const known = new Map((replay.merged || []).map(m => [m.id, { severity: m.severity, lines: (m.sources || []).map(i => lines[i]).filter(l => typeof l === 'string') }]));
  const mf = require(MERGE_FINDINGS);
  const results = toolResultTexts(run.main || []);
  const readLocal = abs => {
    const p = localCopyOf(abs, run.dir, meta);
    if (!p) return null;
    try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  };
  const writes = new Map();
  const bash = [];
  const shards = new Map();
  const bySub = new Map(subs.filter(s => s.meta && s.meta.toolUseId).map(s => [s.meta.toolUseId, s]));
  const dispatches = [];
  let verdictsCalls = 0;
  let verdictsRejected = 0;
  for (const t of main.toolUses) {
    const input = t.input || {};
    if (t.name === 'Write' && typeof input.file_path === 'string') writes.set(path.resolve(project, input.file_path), String(input.content || ''));
    else if (t.name === 'Bash' && typeof input.command === 'string') {
      bash.push(input.command);
      if (/merge-findings\.js\b/.test(input.command) && /--shards\b/.test(input.command)) {
        for (const s of shardsOutput(results.get(t.id))) shards.set(path.resolve(project, s.file), s);
      }
      if (/merge-findings\.js\b/.test(input.command) && /--verdicts\b/.test(input.command)) {
        verdictsCalls++;
        const j = jsonLine(results.get(t.id));
        if (j && j.ok === false) verdictsRejected++;
      }
    } else if ((t.name === 'Agent' || t.name === 'Task') && isSkepticDispatch(String(input.subagent_type || ''), input.prompt)) {
      const sc = scoreDispatch(input.prompt, { project, known, writes: new Map(writes), bash: bash.slice(), shards: new Map(shards), readLocal });
      const sub = bySub.get(t.id);
      const ret = sub ? (sub.d.handback !== null ? sub.d.handback : sub.d.lastText) : '';
      let returnOk = null;
      let problems = [];
      let ruled = [];
      if (sc.ids.length) {
        const v = mf.checkVerdicts(String(sc.tier), sc.ids, [{ file: (sub && sub.agentId) || t.id, text: ret }]);
        returnOk = v.ok;
        problems = ((v.returns[0] || {}).problems || []).map(p => p.kind + ' ' + p.id + (p.word ? ' ' + p.word : ''));
        const rr = mf.readReturn(ret, sc.ids, String(sc.tier));
        ruled = [...new Set([...Object.keys(rr.decided), ...rr.problems.filter(p => p.kind === 'unknown').map(p => p.id)])];
      }
      dispatches.push({ n: dispatches.length + 1, toolUseId: t.id, agentId: sub ? sub.agentId : null, type: String(input.subagent_type || ''),
        ...sc, returned: String(ret || '').trim() !== '', returnOk, problems, ruled });
    }
  }
  const final = run.result && typeof run.result.result === 'string' ? run.result.result : main.lastText;
  const recorded = recordedVerdicts(final, known);
  const lastRuling = {};
  for (const d of dispatches) for (const id of d.ruled) lastRuling[id] = d;
  const judged = Object.keys(recorded).length ? Object.keys(recorded).filter(id => !/^unaudited$/i.test(recorded[id])) : Object.keys(lastRuling);
  const byNum = (x, y) => Number(x.slice(1)) - Number(y.slice(1));
  const count = cls => dispatches.filter(d => d.class === cls).length;
  const summary = {
    dispatches: dispatches.length,
    byteForByte: count('script') + count('verbatim'),
    script: count('script'),
    verbatim: count('verbatim'),
    paraphrased: count('paraphrase'),
    unknown: count('unknown'),
    returnsClean: dispatches.filter(d => d.returnOk === true).length,
    returnsFlagged: dispatches.filter(d => d.returnOk === false).length,
    returnsUnchecked: dispatches.filter(d => d.returnOk === null).length,
    otherWords: dispatches.filter(d => d.asks.some(w => !M2_SKEPTIC_WORDS.includes(w))).length,
    verdictsCalls,
    verdictsRejected,
    recorded: Object.keys(recorded).length,
    ruledFromParaphrase: judged.filter(id => lastRuling[id] && lastRuling[id].class === 'paraphrase').sort(byNum),
    ruledFromUnknown: judged.filter(id => lastRuling[id] && lastRuling[id].class === 'unknown').sort(byNum),
    notJudged: judged.filter(id => !lastRuling[id]).sort(byNum),
  };
  summary.drift = summary.paraphrased > 0;
  a.skeptic = { dispatches, recorded, summary };
  if (!dispatches.length) reasons.push('no-skeptic-dispatch');
  if (!summary.recorded) warnings.push('no-recorded-verdicts');
}

// ---------------------------------------------------------------------------
// The fix role and its oracles (harness research plan Step 11, D3)
// ---------------------------------------------------------------------------
//
// B1 (reports/harness-papers-2026-10-12/b1-fix-verifier.md) showed the fix
// verifier judging only whether the defect a finding named is gone: a fix that
// deleted the cited step passed it 3 of 3 times, and nothing asked whether the
// step still worked. --role fix lets /review's own loop fix the fixture, then
// judges the tree it left with two oracles per runnable planted bug, kept in the
// fixture's oracles/ folder (scripts/fixtures/quality-check/<name>/oracles/; the
// shared half is oracle-lib.js one level above the fixtures) and copied to a temp
// folder only after the session has ended, so the fixer never sees them:
//   gone   the bug's symptom no longer reproduces
//   works  the feature the bug sat in still does its job
// Per bug the run records whether the review raised it, what the run said of its
// fix (the report's Digest line for each R-number that carries the bug, else the
// fix verifiers' returns), and the two verdicts. A bug the run said was FIXED that
// does not pass both oracles is a false FIXED: the miss B1 found, measured.

// The fixture's answer key says which planted bugs no script can run (each such
// bug carries noOracle, the reason) and names the self-test's required pair
// (selfTestPair: a correct fix for one bug and an empty fix, B1's bad-R3 shape of
// the cited lines deleted with nothing in their place, for another), so the
// harness holds neither (#278).
function notRunnable(answers) {
  return Object.fromEntries(answers.bugs.filter(b => b.noOracle).map(b => [b.id, b.noOracle]));
}
const ORACLE_KINDS = ['gone', 'works'];
const ORACLE_EXIT = { PASS: 0, FAIL: 1, UNJUDGED: 2 };
const ORACLE_TIMEOUT_MS = 90 * 1000;

// The oracle files for each runnable planted bug, { id: { gone, works } }, in the
// answer key's order. Throws on half a pair, an oracle that names no planted bug,
// and a bug that has neither a pair nor a noOracle reason, or has both.
function oracleSet(answers, dir) {
  const files = fs.readdirSync(dir).filter(f => /\.(gone|works)\.js$/.test(f));
  const known = new Set(answers.bugs.map(b => b.id));
  const stray = files.filter(f => !known.has(f.replace(/\.(gone|works)\.js$/, '')));
  if (stray.length) throw new Error('oracles that name no planted bug: ' + stray.join(', '));
  const out = {};
  for (const b of answers.bugs) {
    const pair = Object.fromEntries(ORACLE_KINDS.map(k => [k, files.includes(b.id + '.' + k + '.js') ? b.id + '.' + k + '.js' : null]));
    if (b.noOracle) {
      if (pair.gone || pair.works) throw new Error(b.id + ' has an oracle pair and a noOracle reason');
      continue;
    }
    if (!pair.gone && !pair.works) throw new Error(b.id + ' has no oracle pair and no noOracle reason');
    if (!pair.gone || !pair.works) throw new Error(b.id + ' has a ' + (pair.gone ? 'gone' : 'works') + ' oracle and no ' + (pair.gone ? 'works' : 'gone') + ' oracle');
    out[b.id] = pair;
  }
  return out;
}

// The report's Digest section (review.md, After the Report, step 6: "R3: FIXED -
// <what it was, in plain words> - <check>", "R5: NOT FIXED - <what it is, what
// happens if it ships as is, what you are asked> - <what was tried>", "R7:
// PAGED - <the same three parts> - <what needs the human>"; the plain-words
// part arrived with #271), as { R3: 'FIXED', ... }: the first upper-case
// verdict word after the R-number that starts a line. A line naming no
// verdict is skipped.
const DIGEST_VERDICT = /\b(NOT FIXED|FIXED|PAGED|DEFERRED|SKIPPED|UNAUDITED|REVERTED|LOGGED)\b/;
function parseDigest(md) {
  const out = {};
  let inDigest = false;
  let level = 0;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (/^digest\b/i.test(h[2].replace(/[*_`]/g, '').trim())) { inDigest = true; level = h[1].length; continue; }
      if (inDigest && h[1].length <= level) inDigest = false;
      continue;
    }
    if (/^\s*[*_]*digest[*_]*\s*:?\s*$/i.test(line)) { inDigest = true; level = 6; continue; }
    if (!inDigest) continue;
    const m = /^\s*(?:[-*]\s+)?[`*_]*R(\d+)\b(.*)$/.exec(line);
    if (!m) continue;
    const v = DIGEST_VERDICT.exec(m[2]);
    if (v) out['R' + m[1]] = v[1];
  }
  return out;
}

// What the fix verifiers returned (M3's "R3: FIXED" / "R3: NOT FIXED"), as
// { verdicts: { R3: 'FIXED' }, dispatches }; a later verifier's word wins.
function verifierVerdicts(subs) {
  const started = s => ((s.records || []).find(r => r && r.timestamp) || {}).timestamp || '';
  const verifiers = subs.filter(s => /(^|:)fix-verifier$/.test((s.meta && s.meta.agentType) || ''))
    .sort((x, y) => started(x).localeCompare(started(y)));
  const verdicts = {};
  for (const s of verifiers) {
    const text = s.d.handback !== null ? s.d.handback : s.d.lastText;
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = /^\s*(?:[-*]\s+)?[`*_]*R(\d+)[`*_]*\s*:\s*[`*_]*(NOT FIXED|FIXED)\b/.exec(line);
      if (m) verdicts['R' + m[1]] = m[2];
    }
  }
  return { verdicts, dispatches: verifiers.length };
}

// One bug's outcome from its two verdicts: fixed (gone and works), broken (gone,
// and the feature no longer works: B1's fake fix), not-fixed (the symptom still
// reproduces), or unjudged (an oracle could not judge).
function fixOutcome(gone, works) {
  if (gone === 'UNJUDGED' || works === 'UNJUDGED' || !gone || !works) return 'unjudged';
  if (gone === 'FAIL') return 'not-fixed';
  return works === 'PASS' ? 'fixed' : 'broken';
}

function analyzeFix(a, run, subs, answers, warnings) {
  const digest = parseDigest(run.report);
  const ver = verifierVerdicts(subs);
  const judged = run.oracles && Array.isArray(run.oracles.oracles) ? run.oracles : null;
  if (run.report && !Object.keys(digest).length) warnings.push('no-digest');
  if (!judged) warnings.push('not-judged');
  const left = ((run.meta || {}).leftovers || []).length;
  if (left) warnings.push('left-running:' + left);
  a.fix = { digestLines: Object.keys(digest).length, verifierDispatches: ver.dispatches, oraclePort: judged ? judged.port : null,
    judgeError: run.oracles && run.oracles.error ? run.oracles.error : null, bugs: {}, falseFixed: [], unjudged: [] };
  for (const b of answers.bugs) {
    const rids = ((a.survived || {})[b.id] || []).map(e => e.id);
    const reported = rids.map(id => ({ id, digest: digest[id] || null, verifier: ver.verdicts[id] || null }));
    const said = [...new Set(reported.map(r => r.digest || r.verifier).filter(Boolean))];
    const o = judged ? judged.oracles.find(x => x.id === b.id) : null;
    const gone = o && o.gone ? o.gone.verdict : null;
    const works = o && o.works ? o.works.verdict : null;
    const outcome = b.noOracle ? 'not-runnable' : !o ? 'not-judged' : fixOutcome(gone, works);
    const row = {
      raised: ((a.raised || {})[b.id] || []).length > 0, inReport: rids, reported, said: said.join('/') || null,
      gone, works, goneLine: o && o.gone ? o.gone.line : null, worksLine: o && o.works ? o.works.line : null, outcome,
    };
    row.falseFixed = said.includes('FIXED') && (outcome === 'broken' || outcome === 'not-fixed');
    a.fix.bugs[b.id] = row;
    if (row.falseFixed) a.fix.falseFixed.push(b.id);
    if (outcome === 'unjudged') a.fix.unjudged.push(b.id);
  }
}

// The fix run's prompt: no "report only", so the auto loop runs; "no chaining", so
// it stops after the loop instead of chaining into /document (M14).
function fixPrompt(lenses, base) {
  return '/tk:review ' + lenses.join(',') + ' ' + base + '..HEAD no chaining';
}

// A project tree as the oracles judge it: all of it but .git and the review's own
// output folders.
const TREE_SKIP = new Set(['.git', 'reports', 'artifacts']);
function copyTree(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false, verbatimSymlinks: true, filter: s => !TREE_SKIP.has(path.relative(src, s).split(path.sep)[0]) });
}

// Everything the session changed since the planted change, committed or not,
// untracked files included, read through a throwaway index so the project's own
// index is untouched.
function fixDiff(project, from) {
  const index = path.join(os.tmpdir(), 'qc-fix-diff-' + process.pid + '-' + Date.now() + '.index');
  const env = { GIT_INDEX_FILE: index };
  try {
    git(['read-tree', 'HEAD'], project, env);
    git(['add', '-A'], project, env);
    const r = sh('git', ['diff', '--cached', '--binary', from], { cwd: project, env: { ...GIT_ENV, ...env } });
    if (r.status !== 0) throw new Error('git diff failed: ' + r.stderr);
    return r.stdout;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

// Processes still running with their working folder inside `root` (read from
// Linux /proc; none elsewhere): what a session left behind, such as a dev server
// it restarted in the background to see its fix. Left alone, it would hold the
// oracles' port and keep serving the tree, on every interface (it runs without
// loopback.js), after the scratch folder is gone.
function processesUnder(root) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync('/proc'); } catch (e) { return out; }
  for (const name of entries) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    let cwd;
    try { cwd = fs.readlinkSync(path.join('/proc', name, 'cwd')); } catch (e) { continue; }
    if (!isUnder(cwd, root)) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(path.join('/proc', name, 'cmdline'), 'utf8').split('\0').join(' ').trim(); } catch (e) { cmd = ''; }
    out.push({ pid: Number(name), cmd: cmd.slice(0, 200) });
  }
  return out;
}

// playwright-core for the two browser oracles: this checkout's, else the main
// checkout's (a side worktree has no node_modules of its own); null when neither.
function playwrightCore() {
  for (const root of [...new Set([REPO, mainCheckout()])]) {
    const p = path.join(root, '.claude', 'scripts', 'node_modules', 'playwright-core');
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
  }
  return null;
}

// Runs each oracle pair (only those named in opts.only, when given) one at a time,
// each oracle on its own fresh copy of `tree`, starting servers on `port`. The
// oracles go to a temp folder first, with loopback.js and oracle-lib.js beside
// them. A verdict counts only when the oracle's line and exit code agree; anything
// else is UNJUDGED. Resolves { port, at, playwright, oracles: [{ id, gone, works }],
// notRunnable }, each verdict { verdict, line, exit }. opts: fixture (a fixture's
// name, notebook unless given), answers, only, onResult(id, kind, verdict), and dir
// (another oracle folder, for the tests).
async function judgeTree(tree, port, opts) {
  const o = opts || {};
  const src = o.dir || path.join(fixtureDir(o.fixture || DEFAULT_FIXTURE), 'oracles');
  const answers = o.answers || loadAnswers(o.fixture);
  const set = oracleSet(answers, src);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-judge.'));
  const pw = playwrightCore();
  const env = { ...process.env, QC_PLAYWRIGHT_CORE: pw || '' };
  const browsers = path.join(REAL_HOME, '.cache', 'ms-playwright');
  if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const results = [];
  try {
    const dir = path.join(work, 'oracles');
    copyDir(src, dir);
    fs.copyFileSync(LOOPBACK_PRELOAD, path.join(dir, 'loopback.js'));
    fs.copyFileSync(ORACLE_LIB, path.join(dir, 'oracle-lib.js'));
    for (const [id, files] of Object.entries(set)) {
      if (o.only && !o.only.includes(id)) continue;
      const row = { id };
      for (const kind of ORACLE_KINDS) {
        const copy = path.join(work, 'tree-' + id + '-' + kind);
        copyTree(tree, copy);
        const r = await runGroup(process.execPath, [path.join(dir, files[kind]), copy, String(port)], { cwd: work, env }, ORACLE_TIMEOUT_MS, 2000);
        const line = (r.stdout.trim().split('\n').filter(Boolean).pop() || '').trim();
        const said = /^(PASS|FAIL|UNJUDGED)\b/.exec(line);
        const verdict = said && ORACLE_EXIT[said[1]] === r.status ? said[1] : 'UNJUDGED';
        row[kind] = { verdict, line: said ? line : 'no verdict line (exit ' + r.status + (r.timedOut ? ', timed out' : '') + '): ' + (r.stderr.trim().split('\n').pop() || '').slice(0, 200), exit: r.status };
        if (o.onResult) o.onResult(id, kind, row[kind]);
        fs.rmSync(copy, { recursive: true, force: true });
      }
      results.push(row);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { port, at: new Date().toISOString(), playwright: pw, oracles: results, notRunnable: notRunnable(answers) };
}

// Applies self-test-fixes.js edits to a tree: { file, find, replace }, where the
// text must be there exactly once, or { file, remove: true }.
function applyEdits(tree, edits) {
  for (const e of edits) {
    const abs = path.join(tree, e.file);
    if (e.remove) { fs.rmSync(abs); continue; }
    const text = fs.readFileSync(abs, 'utf8');
    const at = text.indexOf(e.find);
    if (at === -1 || text.indexOf(e.find, at + 1) !== -1) throw new Error('a self-test edit to ' + e.file + ' does not match the tree exactly once: ' + JSON.stringify(e.find.slice(0, 80)));
    fs.writeFileSync(abs, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
  }
}

// A free loopback port that is not PORT, the one a real run's server takes.
async function freePort() {
  for (;;) {
    const p = await new Promise((resolve, reject) => {
      const s = require('net').createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); });
    });
    if (p !== PORT) return p;
  }
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

// ---------------------------------------------------------------------------
// The setting a run measured (research plan item 2, P1-C1)
// ---------------------------------------------------------------------------
//
// A score means something only when one thing moved between its two sets. Both
// issue 221 A/Bs and the 7.6.0 catch-rate check pooled baselines whose build,
// finder effort and Claude Code version all moved, and their verdicts had to be
// corrected by hand afterwards (ab-index-mapper.md, ab-review-deps-finder.md).
// A run's setting is { dir, role, harness, arm, labels }:
//   harness  build    the hash of the plugin files the role's path reads (pathHash)
//            session  the session's model and effort
//            claude   the Claude Code version
//            fixture  the review fixture's hash, as run.json records it
//            prompt   the mapper's dispatch prompt, hashed from the saved transcript
//            chunk    the mapper's chunk: its source commit and file list
//   arm      { agent: { model, effort } } for each measured agent
// Every value may be null: a field the run's folder cannot supply is unknown,
// printed so, and never counted as a difference.

// The plugin files each role's measured path reads, relative to the plugin root.
// For a review: the review command and its two runner scripts, the shared review
// fragments, the criteria, each finder with the two skills it preloads, and the
// skeptic (the review-path list of research item 7, P1-C4, plus the preloaded
// skills, which are part of every finder's prompt). For the mapper: /index, whose
// Step 3 template is the dispatch prompt, and the mapper's own file.
const PATH_FILES = {
  review: /^(scripts\/(run-checks|merge-findings)\.js|commands\/review\.md|skills\/shared\/(hitl-loop|report-format|dispatch-format|finding-contract|criteria-[a-z]+)\.md|skills\/(review-[a-z]+-criteria|dispatch-contract)\/SKILL\.md|agents\/(review-[a-z]+-finder|audit-skeptic)\.md)$/,
  mapper: /^(commands\/index\.md|agents\/index-mapper\.md)$/,
};

// An agent file without its model and effort lines. Those lines are the arm,
// which the arm line records, so a pin change alone never reads as a new build,
// and a file hashes the same before and after the arm's patch (patchAgent only
// rewrites or adds those two lines).
function stripArmLines(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return text;
  const kept = fm[1].split(/\r?\n/).filter(l => !/^(model|effort):/.test(l));
  return '---\n' + kept.join('\n') + '\n---' + text.slice(fm[0].length);
}

// The hash of a role's path files, from { relPath: Buffer|string } (paths relative
// to the plugin root, any other path ignored): 16 hex digits, or null when none of
// the role's files is there.
function pathHash(role, files) {
  const re = PATH_FILES[role] || PATH_FILES.review;
  const rels = Object.keys(files || {}).filter(r => re.test(r)).sort();
  if (rels.length === 0) return null;
  const h = crypto.createHash('sha256');
  for (const rel of rels) {
    const text = Buffer.isBuffer(files[rel]) ? files[rel].toString('utf8') : String(files[rel]);
    h.update(rel + '\0' + (/^agents\//.test(rel) ? stripArmLines(text) : text) + '\0');
  }
  return h.digest('hex').slice(0, 16);
}

// The settings fields in print order, with the words a reader sees.
const SETTING_FIELDS = [['build', 'build'], ['session', 'session model/effort'], ['claude', 'Claude Code'],
  ['fixture', 'fixture'], ['prompt', 'mapper prompt hash'], ['chunk', 'mapper chunk']];
function knownValues(values) {
  return [...new Set(values.filter(v => v !== null && v !== undefined))];
}

// The short name of a measured agent: review-deps-finder -> deps.
function agentShort(name) {
  return String(name).replace(/^review-|-finder$/g, '');
}

// How a field's value reads, with the runs that carry it: a build hash is shown
// with the commits (or tree builds) it was hashed from, a fixture hash with the
// fixture's name.
function settingValue(field, value, runs) {
  // A fixture hash reads with the fixture's name, so a score across two fixtures
  // says which two (#278).
  if (field === 'fixture') {
    const names = knownValues(runs.filter(r => r.harness.fixture === value).map(r => (r.labels || {}).fixture));
    return names.length ? names.join('+') + ' (' + String(value).slice(0, 8) + ')' : String(value);
  }
  if (field !== 'build') return String(value);
  const labels = knownValues(runs.filter(r => r.harness.build === value).map(r => (r.labels || {}).build));
  return (labels.join('+') || 'build') + ' (path ' + String(value).slice(0, 8) + ')';
}

// The two sets' settings compared. Returns { kind, confounded, notUniform, differs,
// armMoved, confounds, summary }: kind is 'same', 'model' (the arm moved, the harness
// held), 'harness' (the build moved, and the mapper prompt with it, the arm held) or
// 'confounded'; confounds names each field that makes it so ("baseline: build",
// "between: Claude Code"); summary is the sentence the score prints.
function compareSettings(candidate, baseline) {
  const sets = { candidate, baseline };
  const notUniform = [];
  const one = {};
  for (const [name, runs] of Object.entries(sets)) {
    one[name] = { harness: {}, arm: {} };
    for (const [field, label] of SETTING_FIELDS) {
      const v = knownValues(runs.map(r => r.harness[field]));
      if (v.length > 1) notUniform.push({ set: name, field, label, values: v.map(x => settingValue(field, x, runs)) });
      one[name].harness[field] = v.length === 1 ? v[0] : null;
    }
    const agents = knownValues(runs.flatMap(r => Object.keys(r.arm || {})));
    for (const ag of agents) one[name].arm[ag] = {};
    for (const part of ['model', 'effort']) {
      // Agents that share one spread read as one group: "8 finders high, medium".
      const groups = new Map();
      for (const ag of agents) {
        const v = knownValues(runs.map(r => ((r.arm || {})[ag] || {})[part]));
        one[name].arm[ag][part] = v.length === 1 ? v[0] : null;
        if (v.length > 1) groups.set(v.join(', '), [...(groups.get(v.join(', ')) || []), agentShort(ag)]);
      }
      if (groups.size) {
        const values = [...groups.entries()].map(([v, ags]) => (ags.length === 1 ? ags[0] : ags.length + ' agents (' + ags.join(', ') + ')') + ': ' + v);
        notUniform.push({ set: name, field: 'arm ' + part, label: 'arm ' + part, values });
      }
    }
  }
  const differs = [];
  for (const [field, label] of SETTING_FIELDS) {
    const c = one.candidate.harness[field];
    const b = one.baseline.harness[field];
    if (c !== null && b !== null && c !== b) differs.push({ field, label, candidate: settingValue(field, c, candidate), baseline: settingValue(field, b, baseline) });
  }
  const armMoved = [];
  for (const ag of knownValues([...Object.keys(one.candidate.arm), ...Object.keys(one.baseline.arm)])) {
    for (const part of ['model', 'effort']) {
      const c = (one.candidate.arm[ag] || {})[part];
      const b = (one.baseline.arm[ag] || {})[part];
      if (c !== null && c !== undefined && b !== null && b !== undefined && c !== b) armMoved.push({ agent: ag, part, candidate: c, baseline: b });
    }
  }
  const confounds = notUniform.map(n => n.set + ': ' + n.label);
  // The mapper prompt is read from the build, so it may move with the build (or
  // where either build is unknown); on one recorded build, a new prompt is a
  // second thing moving.
  const buildHeld = one.candidate.harness.build !== null && one.candidate.harness.build === one.baseline.harness.build;
  const buildField = f => f === 'build' || (f === 'prompt' && !buildHeld);
  let kind;
  if (armMoved.length) {
    kind = 'model';
    for (const d of differs) confounds.push('between: ' + d.label);
  } else if (differs.length) {
    kind = differs.some(d => buildField(d.field)) ? 'harness' : 'same';
    for (const d of differs) if (!buildField(d.field)) confounds.push('between: ' + d.label);
  } else kind = 'same';
  const confounded = confounds.length > 0;
  // The sentence: what kind of A/B it is, then whatever else moved.
  const armWords = () => {
    const groups = new Map();
    for (const m of armMoved) {
      const k = m.part + ' ' + m.candidate + ' vs ' + m.baseline;
      groups.set(k, [...(groups.get(k) || []), agentShort(m.agent)]);
    }
    return [...groups.entries()].map(([k, ags]) => (ags.length === 1 ? ags[0] : ags.length + ' agents') + ' ' + k).join('; ');
  };
  const diffWords = list => list.map(d => d.label + ' ' + d.candidate + ' vs ' + d.baseline).join(', ');
  // "Held" is said only when both sets are uniform, since otherwise nothing is.
  const held = notUniform.length === 0;
  const parts = [];
  if (kind === 'model') {
    parts.push('a model A/B, arm ' + armWords() + (differs.length ? ', with the harness moved too: ' + diffWords(differs) : held ? ', harness held' : ''));
  } else if (kind === 'harness') {
    const extra = differs.filter(d => !buildField(d.field));
    parts.push('a harness A/B, ' + diffWords(differs.filter(d => buildField(d.field))) + (held ? ', arm held' : '') + (extra.length ? ', with more moved too: ' + diffWords(extra) : ''));
  } else if (differs.length) {
    parts.push('between the sets: ' + diffWords(differs));
  } else if (held) parts.push('the same setting on both sides');
  for (const n of notUniform) parts.push('the ' + n.set + ' set is not uniform in ' + n.label + ': ' + n.values.join(' | '));
  return { kind: confounded ? 'confounded' : kind, confounded, notUniform, differs, armMoved, confounds, summary: parts.join('; ') };
}

// True unless a recorded field of x and y differs: two runs on one setting.
function sameSetting(x, y) {
  for (const [field] of SETTING_FIELDS) {
    const a = x.harness[field];
    const b = y.harness[field];
    if (a !== null && a !== undefined && b !== null && b !== undefined && a !== b) return false;
  }
  for (const ag of knownValues([...Object.keys(x.arm || {}), ...Object.keys(y.arm || {})])) {
    for (const part of ['model', 'effort']) {
      const a = ((x.arm || {})[ag] || {})[part];
      const b = ((y.arm || {})[ag] || {})[part];
      if (a !== null && a !== undefined && b !== null && b !== undefined && a !== b) return false;
    }
  }
  return true;
}

// Was `id` lost to the harness in analysis `a`: raised, then killed only by
// checks the runner refused (P1-C2)? A caught bug never is.
function harnessLostIn(a, id) {
  return Array.isArray(a.harnessLost) && a.harnessLost.includes(id) && !caught(a, id);
}

// Scores one candidate set against a baseline set (arrays of analyses) per the
// rules in the header. `ids` lists what can be caught: bug ids, or chunk files.
// opts: knownId and requireKnown (the known-answer bar); allowDrift, the reason a
// confounded comparison is scored anyway; pool, saved analyses to draw the noise
// lines from. An analysis that carries `setting` (runSetting) takes part in the
// comparison check; when any run lacks one, the check is skipped, as for runs
// scored before the settings existed.
function scoreSets(candidate, baseline, ids, opts) {
  const o = opts || {};
  const vb = baseline.filter(x => x.valid);
  const vc = candidate.filter(x => x.valid);
  const s = {
    baselineRuns: baseline.length, baselineValid: vb.length, candidateRuns: candidate.length, candidateValid: vc.length,
    invalid: [...baseline, ...candidate].filter(x => !x.valid).map(x => ({ dir: x.dir, reasons: x.reasons })),
    stable: [], noisy: [], never: [], perId: {}, failed: [], single: [], unjudged: [], harnessBugs: [], weak: [], noise: {},
    compare: null, drift: null, verdict: '', why: [],
    costUsd: mean(vc.map(x => x.costUsd)), baselineCostUsd: mean(vb.map(x => x.costUsd)),
    wallMs: mean(vc.map(x => x.wallMs)), baselineWallMs: mean(vb.map(x => x.wallMs)),
  };
  if (vb.length === 0) { s.verdict = 'INVALID'; s.why.push('no valid baseline run'); return s; }
  if (vc.length === 0) { s.verdict = 'INVALID'; s.why.push('no valid candidate run'); return s; }
  if (vc.every(x => x.setting) && vb.every(x => x.setting)) s.compare = compareSettings(vc.map(x => x.setting), vb.map(x => x.setting));
  s.harnessLostRuns = vc.flatMap(x => (x.harnessLost || []).filter(id => harnessLostIn(x, id))
    .map(id => ({ dir: x.dir, id, kills: ((x.killedAs || {})[id] || { kills: [] }).kills.map(k => k.id + ' ' + k.verdict) })));
  for (const id of ids) {
    // A run that lost the bug to the harness is left out of its count, on either
    // side, as an INVALID run is left out of the whole score: one refused check in
    // a baseline run must not turn a stable bug noisy and so skip its bar.
    const lostB = vb.filter(x => harnessLostIn(x, id)).length;
    const countedB = vb.length - lostB;
    const inB = vb.filter(x => caught(x, id)).length;
    const inC = vc.filter(x => caught(x, id)).length;
    const lostC = vc.filter(x => harnessLostIn(x, id)).length;
    const counted = vc.length - lostC;
    const raisedC = vc.filter(x => x.raised && x.raised[id] && x.raised[id].length > 0).length;
    s.perId[id] = { baseline: inB + '/' + countedB, baselineHarnessLost: lostB, candidate: inC + '/' + counted, raisedCandidate: raisedC + '/' + vc.length, harnessLost: lostC };
    if (countedB > 0 && inB === countedB) s.stable.push(id);
    else if (inB > 0) s.noisy.push(id);
    else s.never.push(id);
  }
  for (const id of s.stable) {
    const lostC = vc.filter(x => harnessLostIn(x, id)).length;
    const counted = vc.length - lostC;
    const misses = counted - vc.filter(x => caught(x, id)).length;
    if (misses >= 2) s.failed.push(id);
    else if (lostC >= 2) s.harnessBugs.push(id);
    // One miss in the only counted run, or no counted run at all: run once more.
    else if (misses === 1 && counted === 1) s.single.push(id);
    else if (counted === 0) s.unjudged.push(id);
  }
  // The noise lines: each stable bug against every saved valid run on the
  // baseline's setting (any of its settings, when it is not uniform).
  if (Array.isArray(o.pool) && vb.every(x => x.setting)) {
    const role = vb[0].role;
    const pool = o.pool.filter(p => p.valid && p.role === role && p.setting && vb.some(b => sameSetting(p.setting, b.setting)));
    s.poolRuns = pool.length;
    for (const id of s.stable) {
      const runs = pool.filter(p => !harnessLostIn(p, id));
      s.noise[id] = { caught: runs.filter(p => caught(p, id)).length, runs: runs.length };
    }
    s.weak = s.failed.filter(id => s.noise[id] && s.noise[id].caught < s.noise[id].runs);
  }
  if (s.compare && s.compare.confounded) {
    if (o.allowDrift) s.drift = { reason: o.allowDrift, confounds: s.compare.confounds };
    else { s.verdict = 'CONFOUNDED'; s.why.push(s.compare.summary); return s; }
  }
  const breakRuns = vc.filter(x => (x.contractBreaks || 0) > 0).length;
  if (o.knownId && o.requireKnown && !s.stable.includes(o.knownId)) {
    s.verdict = 'PAGE';
    s.why.push('the known-answer case is not a stable baseline catch, so the bar for this arm cannot be applied');
    return s;
  }
  if (s.failed.length) {
    s.why.push('missed twice: ' + s.failed.map(id => s.weak.includes(id)
      ? id + ' (weak: the baseline setting caught it in only ' + s.noise[id].caught + ' of ' + s.noise[id].runs + ' saved runs)'
      : id).join(', '));
  }
  if (breakRuns >= 2) s.why.push('contract breaks in ' + breakRuns + ' runs');
  if (s.harnessBugs.length) s.why.push('harness-lost in two runs: ' + s.harnessBugs.join(', ') + ' (the runner refused the check; fix the runner, then rerun)');
  if (s.failed.length || breakRuns >= 2) { s.verdict = 'FAIL'; return s; }
  if (s.harnessBugs.length) { s.verdict = 'HARNESS'; return s; }
  if (s.single.length || s.unjudged.length || (breakRuns === 1 && vc.length === 1)) {
    s.verdict = 'RERUN';
    if (s.single.length) s.why.push('missed once in a single run: ' + s.single.join(', '));
    if (s.unjudged.length) s.why.push('lost to the harness in its only run: ' + s.unjudged.join(', '));
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
    // A fix run's oracle verdicts on its final tree (judgeTree), or null.
    oracles: readJson(path.join(dir, 'oracles.json')),
  };
}

// The names of the fixtures under `root` (FIXTURES_ROOT unless given): the
// folders that hold an answers.json, sorted.
function fixtureNames(root) {
  const r = root || FIXTURES_ROOT;
  let entries;
  try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch (e) { return []; }
  return entries.filter(e => e.isDirectory() && fs.existsSync(path.join(r, e.name, 'answers.json'))).map(e => e.name).sort();
}

// The folder of the fixture called `name` under `root` (FIXTURES_ROOT unless a
// test passes another). Only a plain name whose folder holds an answers.json
// resolves; anything else (a path, a folder with no key) throws, naming the
// fixtures there are.
function fixtureDir(name, root) {
  const r = root || FIXTURES_ROOT;
  const names = fixtureNames(r);
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(name) || !names.includes(name)) {
    throw new Error('no fixture called ' + JSON.stringify(String(name)) + ' under ' + path.relative(REPO, r) + '; the fixtures are: ' + (names.join(', ') || 'none'));
  }
  return path.join(r, name);
}

// A fixture's answer key, by name (notebook unless given).
function loadAnswers(name, root) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(name || DEFAULT_FIXTURE, root), 'answers.json'), 'utf8'));
}

// What run.json records of the fixture a run used: its hash and its name.
function fixtureRecord(name, root) {
  return { fixture: fixtureHash(fixtureDir(name, root)), fixtureName: name };
}

// The fixture a saved run used, from its record; a run saved before #278 has no
// name and ran on the only fixture there was, Notebook.
function runFixtureName(meta) {
  return (meta && meta.fixtureName) || DEFAULT_FIXTURE;
}

// A saved run analyzed against its own fixture's answer key, the way --check and
// --judge read it: { fixtureName, answers, analysis }. `root` is for the tests.
function checkRun(dir, root) {
  const run = loadRun(dir);
  const fixtureName = runFixtureName(run.meta);
  const answers = loadAnswers(fixtureName, root);
  return { fixtureName, answers, analysis: analyzeRun(run, answers) };
}

// A role's path files in a build folder, as { relPath: Buffer }. Read at run time,
// so a tree build, which leaves no commit behind, still records its build hash.
function dirPathFiles(dir, role) {
  const re = PATH_FILES[role] || PATH_FILES.review;
  const out = {};
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    if (re.test(rel)) out[rel] = fs.readFileSync(f);
  }
  return out;
}

// The same files at a commit of this repository, through git (one ls-tree, one
// cat-file), or null when the commit is not in this clone. Cached per commit.
// Only a commit id reaches git: run.json is data, never an option.
const SHA_RE = /^[0-9a-f]{7,40}$/;
const gitPathCache = new Map();
function gitPathFiles(sha, role) {
  const key = sha + ':' + role;
  if (gitPathCache.has(key)) return gitPathCache.get(key);
  if (!SHA_RE.test(String(sha))) return null;
  let out = null;
  const re = PATH_FILES[role] || PATH_FILES.review;
  const ls = spawnSync('git', ['ls-tree', '-r', sha, '--', 'plugin/'], { cwd: REPO, env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ls.status === 0) {
    const want = ls.stdout.split('\n').map(l => /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l)).filter(Boolean)
      .map(m => ({ oid: m[1], rel: m[2].replace(/^plugin\//, '') })).filter(e => re.test(e.rel));
    out = {};
    if (want.length) {
      const cat = spawnSync('git', ['cat-file', '--batch'], { cwd: REPO, env: GIT_ENV, input: want.map(e => e.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
      const buf = cat.status === 0 ? cat.stdout : null;
      let at = 0;
      for (const e of want) {
        // Each object comes back as "<oid> blob <size>\n<bytes>\n".
        const nl = buf ? buf.indexOf(10, at) : -1;
        const head = nl === -1 ? [] : buf.subarray(at, nl).toString('utf8').split(' ');
        if (head[1] !== 'blob') { out = null; break; }
        const size = Number(head[2]);
        out[e.rel] = buf.subarray(nl + 1, nl + 1 + size);
        at = nl + 1 + size + 1;
      }
    }
  }
  gitPathCache.set(key, out);
  return out;
}

// One agent file's text at a commit, or null.
const gitAgentCache = new Map();
function gitAgentText(sha, name) {
  const key = sha + ':' + name;
  if (!SHA_RE.test(String(sha))) return null;
  if (!gitAgentCache.has(key)) {
    const r = spawnSync('git', ['show', sha + ':plugin/agents/' + name + '.md'], { cwd: REPO, env: GIT_ENV, encoding: 'utf8' });
    gitAgentCache.set(key, r.status === 0 ? r.stdout : null);
  }
  return gitAgentCache.get(key);
}

// The mapper's dispatch prompt as the session sent it, hashed with its whitespace
// collapsed (the same reading the prompt-mismatch check makes), or null when the
// transcript does not hold the dispatch.
function mapperPromptHash(run) {
  const sub = (run.subagents || []).find(x => /index-mapper$/.test((x.meta && x.meta.agentType) || ''));
  if (!sub || !sub.meta || !sub.meta.toolUseId) return null;
  const call = digestRecords(run.main || []).toolUses.find(t => (t.name === 'Agent' || t.name === 'Task') && t.id === sub.meta.toolUseId);
  if (!call || typeof call.input.prompt !== 'string') return null;
  return shortHash(call.input.prompt.replace(/\s+/g, ' ').trim());
}

// Each measured agent's { model, effort }: the arm's patch, else the agent as the
// build shipped it (run.json's shipped list, else the agent file at the build's
// commit, the way armSettings reads it: no effort line is high). The model is the
// family the run expected the agent to answer on when run.json records one
// (expect.finderModels, expect.mapper: they carry the review's mode, so a cheap run
// reads as Sonnet), else the file's alias, else (inherit, no line) the session's.
// Either part is null when the folder cannot supply it.
function armOf(meta, role) {
  const names = role === 'mapper' ? ['index-mapper'] : FINDER_KINDS.map(k => 'review-' + k + '-finder');
  const expect = meta.expect || {};
  const sessionFamily = familyOf((meta.session || {}).model);
  const sha = meta.build && meta.build.sha;
  const out = {};
  for (const name of names) {
    const rec = (meta.patch || []).find(x => x.agent === name) || (meta.shipped || []).find(x => x.agent === name);
    let model = null;
    let effort = null;
    let fileKnown = false;
    if (rec) { model = rec.model || null; effort = rec.effort || null; fileKnown = true; }
    else if (sha) {
      const text = gitAgentText(sha, name);
      if (text !== null) { model = frontmatterValue(text, 'model'); effort = frontmatterValue(text, 'effort') || 'high'; fileKnown = true; }
    }
    const kind = /^review-([a-z]+)-finder$/.exec(name);
    const expected = kind ? (expect.finderModels || {})[kind[1]] : (role === 'mapper' ? expect.mapper : null);
    let family = expected || familyOf(model);
    if (!family && fileKnown) family = sessionFamily;
    out[name] = { model: family || null, effort: effort || null };
  }
  return out;
}

// A run's setting (see "The setting a run measured"), from its loaded folder.
// The build hash is the one run.json recorded at run time (meta.build.pathHashes),
// else the one git computes from the build's commit; a tree build from before the
// hashes were recorded has neither, so its build is unknown.
function runSetting(run) {
  const meta = run.meta || {};
  const role = meta.role === 'mapper' ? 'mapper' : 'review';
  const build = meta.build || {};
  const session = meta.session || {};
  let buildHash = (build.pathHashes && build.pathHashes[role]) || null;
  if (!buildHash && build.sha) {
    const files = gitPathFiles(build.sha, role);
    buildHash = files ? pathHash(role, files) : null;
  }
  const cc = /(\d+\.\d+\.\d+)/.exec(String(session.claude || ''));
  const chunk = role === 'mapper' && meta.chunk ? String(meta.chunk.sourceRef || '?').slice(0, 7) + ':' + shortHash((meta.chunk.files || []).join('\n')).slice(0, 8) : null;
  return {
    dir: run.dir, role,
    harness: {
      build: buildHash,
      session: session.model && session.effort ? session.model + '/' + session.effort : null,
      claude: cc ? cc[1] : null,
      fixture: meta.fixture || null,
      prompt: role === 'mapper' ? mapperPromptHash(run) : null,
      chunk,
    },
    arm: armOf(meta, role),
    labels: { build: build.sha ? build.sha.slice(0, 7) : build.spec ? build.spec + (build.version ? ' ' + build.version : '') : null, fixture: runFixtureName(meta) },
  };
}

// The two lines a score prints for a run: its harness and its arm. A field the
// folder could not supply reads "unknown".
function settingLines(setting) {
  const h = setting.harness;
  const u = v => (v === null || v === undefined ? 'unknown' : v);
  const parts = ['build ' + (h.build ? settingValue('build', h.build, [setting]) : 'unknown' + (setting.labels.build ? ' (' + setting.labels.build + ', no recorded hash)' : '')),
    'session ' + u(h.session), 'Claude Code ' + u(h.claude), 'fixture ' + (h.fixture ? settingValue('fixture', h.fixture, [setting]) : 'unknown')];
  if (setting.role === 'mapper') parts.push('prompt ' + u(h.prompt), 'chunk ' + u(h.chunk));
  const groups = new Map();
  for (const [ag, v] of Object.entries(setting.arm || {})) {
    const k = (v.model || 'unknown') + '/' + (v.effort || 'unknown');
    groups.set(k, [...(groups.get(k) || []), agentShort(ag)]);
  }
  const arm = [...groups.entries()].map(([k, ags]) => ags.join(', ') + ' ' + k).join('; ');
  return { harness: parts.join(', '), arm: arm || 'unknown' };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// A run's folder name: <stamp>-<kind>-<build>[-<fixture>][-<label>], the fixture
// named only when it is not the default, so a Notebook run's name is what it was
// before there were two fixtures (#278).
function runDirName(p) {
  return p.stamp + '-' + p.kind + '-' + p.build
    + (p.fixture && p.fixture !== DEFAULT_FIXTURE ? '-' + p.fixture : '')
    + (p.label ? '-' + p.label.replace(/[^a-z0-9-]+/gi, '-') : '');
}

// A run's ledger line, from its run.json record: written however the run ends
// (review R14), and naming the fixture it ran on.
function ledgerRow(meta, cost, valid, dir) {
  return { at: meta.endedAt || new Date().toISOString(), role: meta.role, arm: meta.arm, probe: meta.probe,
    build: meta.build.spec, sha: meta.build.sha, fixtureName: runFixtureName(meta), ...cost, valid, dir };
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

// A fixture's hash, from its folder: every base/ and change/ file, named by its
// path inside the fixture's own folder, so moving the folder leaves the hash as
// it was (#278: the saved Notebook runs stay comparable after the move).
function fixtureHash(dir) {
  const h = crypto.createHash('sha256');
  for (const f of walk(dir).filter(f => /^(base|change)\//.test(path.relative(dir, f).split(path.sep).join('/'))).sort()) {
    h.update(path.relative(dir, f) + '\0');
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

// A review fixture (its folder, `dir`) as a two-commit repo, the commit messages
// and author named by its answer key's `app`; returns the two commit ids.
function buildReviewProject(project, planModels, dir) {
  const app = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')).app;
  fs.mkdirSync(project, { recursive: true });
  copyFixture(path.join(dir, 'base'), project);
  if (planModels) {
    const planFile = path.join(project, 'plans', 'PLAN-fixture.md');
    const text = fs.readFileSync(planFile, 'utf8').replace(/(\*\*Overall Progress:\*\*[^\n]*\n)/, '$1**Models:** ' + planModels + '\n');
    fs.writeFileSync(planFile, text);
  }
  const who = ['-c', 'user.name=' + app.name + ' Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false'];
  git(['init', '-q', '-b', 'main'], project);
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', app.baseMessage], project, { GIT_AUTHOR_DATE: '2026-09-30T12:00:00Z', GIT_COMMITTER_DATE: '2026-09-30T12:00:00Z' });
  const base = git(['rev-parse', 'HEAD'], project);
  copyFixture(path.join(dir, 'change'), project);
  git(['add', '-A'], project);
  git([...who, 'commit', '-q', '-m', app.changeMessage], project, { GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' });
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

// The build hash of each role's path files, taken before the arm's patch (the
// patch touches only lines the hash leaves out anyway). A read that fails leaves
// null, which the score prints as unknown; it never stops the run.
function buildPathHashes(dir) {
  const out = {};
  for (const role of Object.keys(PATH_FILES)) {
    try { out[role] = pathHash(role, dirPathFiles(dir, role)); } catch (e) { out[role] = null; }
  }
  return out;
}

// The arm's settings for the measured agents, read against the build's files.
function armSettings(role, arm, build, effortFlag, only) {
  const files = role === 'mapper' ? ['index-mapper'] : FINDER_KINDS.map(k => 'review-' + k + '-finder');
  // --only names the agents the arm patches; every other measured agent ships as
  // the build has it, so a single helper can be measured against unchanged peers.
  const onlyNames = Array.isArray(only) && only.length ? only : null;
  if (onlyNames) {
    const unknown = onlyNames.filter(n => !files.includes(n));
    if (unknown.length) throw new Error('--only names no ' + role + ' agent: ' + unknown.join(', ') + ' (choose from ' + files.join(', ') + ')');
  }
  const out = [];
  for (const name of files) {
    const file = path.join(build.dir, 'agents', name + '.md');
    const text = fs.readFileSync(file, 'utf8');
    const current = frontmatterValue(text, 'effort') || 'high';
    let model;
    let effort;
    if (arm === 'ship' || (onlyNames && !onlyNames.includes(name))) {
      // As shipped: nothing is patched, so --effort does not apply.
      out.push({ file, name, before: { model: frontmatterValue(text, 'model'), effort: current }, model: frontmatterValue(text, 'model'), effort: current, shipped: true });
      continue;
    }
    if (arm === 'a') { model = SESSION_MODEL; effort = role === 'mapper' ? 'medium' : current; }
    else if (arm === 'b') { model = SESSION_MODEL; effort = lowerEffort(role === 'mapper' ? 'medium' : current); }
    else if (arm === 'c') { model = 'sonnet'; effort = effortFlag; }
    else if (arm === 'h') { model = 'haiku'; effort = effortFlag || 'medium'; }
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
  return Object.fromEntries(FINDER_KINDS.map(k => [k, modeFamily(mode, read('review-' + k + '-finder'), sessionFamily, 'review-' + k + '-finder')]));
}
function mapperModel(mode, buildDir, sessionFamily) {
  return modeFamily(mode, fs.readFileSync(path.join(buildDir, 'agents', 'index-mapper.md'), 'utf8'), sessionFamily, 'index-mapper');
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

// What a measured session may not reach (#277). The planted-bug fixture's answer
// key is tracked in a public repository, and harness2's own validation run saw a
// rollout download its task's rubric unprompted, so the session's web tools are
// off beside the page-publishing ones. The network itself stays on: the
// dependency lens runs `npm audit` and `gh api`, and one planted bug needs them.
const DISALLOWED_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData', 'WebFetch', 'WebSearch'];

// Key-like variable names the session never sees; names, never values, are
// recorded. The match is by suffix family (any name ending _KEY, not only
// _API_KEY, so the toolkit's own FAL_KEY and a cloud access pair go too; review
// of #277, R14). The session's own CLAUDE_CODE_* variables stay, and so do the
// GitHub CLI's two token names, for the dependency lens (owner's decision, #277).
const SECRET_NAME_RE = /(_KEY|_SECRET|_PASSWORD|_TOKEN|_ACCESS_KEY_ID)$/;
const SECRET_KEEP_RE = /^(CLAUDE_CODE_|GH_TOKEN$|GITHUB_TOKEN$)/;

// Deletes the key-like names from env in place and returns them, sorted.
function stripSecrets(env) {
  const stripped = [];
  for (const k of Object.keys(env)) {
    if (SECRET_NAME_RE.test(k) && !SECRET_KEEP_RE.test(k)) { delete env[k]; stripped.push(k); }
  }
  return stripped.sort();
}

// The entries of the temp root at session start, so the analyzer can flag a
// read of a folder another run left there (the stale-tmp warning). The
// scratchpad root (claude-<uid>, where Claude Code keeps each session's
// scratchpad as <project slug>/<session id>/) is recorded as its session folders
// and loose entries, never as the root itself: the measured session's own
// scratchpad is a new session id, absent from the list, while an older
// session's is in it. The record keeps at most TMP_SNAPSHOT_MAX names and says
// when it cut the list: a 200-name cap dropped the harness's own run folders on
// a machine with 355 entries (review of #277, R19).
const TMP_SNAPSHOT_MAX = 1000;
function tmpSnapshot(tmpRoot) {
  let names;
  try { names = fs.readdirSync(tmpRoot).sort(); } catch (e) { return []; }
  const scratchRoot = typeof process.getuid === 'function' ? 'claude-' + process.getuid() : null;
  const out = [];
  for (const name of names) {
    if (name !== scratchRoot) { out.push(name); continue; }
    let slugs;
    try { slugs = fs.readdirSync(path.join(tmpRoot, name)).sort(); } catch (e) { continue; }
    for (const slug of slugs) {
      let sessions = null;
      try { if (fs.statSync(path.join(tmpRoot, name, slug)).isDirectory()) sessions = fs.readdirSync(path.join(tmpRoot, name, slug)).sort(); } catch (e) { sessions = null; }
      if (sessions === null) out.push(name + '/' + slug);
      else for (const s of sessions) out.push(name + '/' + slug + '/' + s);
    }
  }
  return out;
}

// The record of what the session ran under, written into run.json beside
// startedAt and printed in the run summary. It is not part of the compared
// setting (settingLines), so a run saved before #277 still compares.
function restrictionsRecord(tmpRoot, strippedNames) {
  const all = tmpSnapshot(tmpRoot);
  return { disallowedTools: DISALLOWED_TOOLS.slice(), strippedEnv: (strippedNames || []).slice(), tmpBefore: all.slice(0, TMP_SNAPSHOT_MAX), tmpBeforeTruncated: all.length > TMP_SNAPSHOT_MAX };
}

function sessionEnv(tmp, extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^CLAUDE_CODE_SUBAGENT_MODEL/.test(k) || /^ANTHROPIC_(MODEL|DEFAULT_|SMALL_FAST_MODEL)/.test(k) || k === 'CLAUDE_CODE_EFFORT_LEVEL') delete env[k];
  }
  const strippedNames = stripSecrets(env);
  env.PATH = makeShims(tmp) + path.delimiter + env.PATH;
  const browsers = path.join(REAL_HOME, '.cache', 'ms-playwright');
  if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const out = { ...env, ...(extra || {}) };
  // The stripped names ride along for the run's record, non-enumerable so the
  // spawned session never sees a variable by that name.
  Object.defineProperty(out, 'strippedNames', { value: strippedNames, enumerable: false });
  return out;
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

// The argument list one headless session is started with, through
// scripts/setup/headless-session.sh. Exported so the suite can check what the
// session may not reach (#277) without starting one.
function sessionArgs(o) {
  return [HARNESS, '--build', o.build, '--project', o.project, '--home', o.home, '--mode', 'bypassPermissions', '--',
    '--model', o.sessionModel || SESSION_MODEL, '--effort', SESSION_EFFORT, '--output-format', 'json', '--max-budget-usd', String(o.maxUsd),
    '--strict-mcp-config', '--disallowedTools', DISALLOWED_TOOLS.join(','),
    '--append-system-prompt', SYSTEM_NOTE, o.prompt];
}

// One headless session through scripts/setup/headless-session.sh.
async function runSession(o) {
  const args = sessionArgs(o);
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

// The next run's worst case: the most an earlier run of its role cost, else the
// role's default, and never more than the run's own cap, which the session itself
// enforces (--max-budget-usd). Without the cap a first run of a role in a fresh
// checkout was sized at the role default and refused under an approval that
// covered it (issue 221: a $7 deps-finder run refused for $25).
function budgetEstimate(rows, role, maxUsd) {
  const sameRole = rows.filter(r => r.role === role && typeof r.costUsd === 'number').map(r => r.costUsd);
  const estimate = sameRole.length ? Math.max(...sameRole) : DEFAULT_MAX_USD[role] || DEFAULT_MAX_USD.probe;
  return typeof maxUsd === 'number' && maxUsd > 0 ? Math.min(estimate, maxUsd) : estimate;
}

function budgetCheck(role, maxUsd) {
  const rows = ledger();
  const spent = rows.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const approval = readJson(BUDGET);
  const measured = rows.filter(r => r.role === 'review' || r.role === 'mapper' || r.role === 'skeptic' || r.role === 'fix');
  if (!approval) {
    if (measured.length === 0) return { ok: true, spent, note: 'first measured run: no approval needed yet; its cost sizes the request' };
    return { ok: false, spent, page: 'Budget stop: the first measured run is done and the owner has not approved a budget. Ask the owner, then record the answer with --approve <usd>.' };
  }
  const estimate = budgetEstimate(rows, role, maxUsd);
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

// Runs each [what, fn] step whatever the one before it did, so one failure (a
// full disk, a folder gone missing) cannot skip the rest: the server still stops,
// the scratch folder still goes, and a session that ran still reaches its ledger
// line (review R14, second round). Reports each failure and returns their names.
function runSteps(steps, report = msg => console.error('quality-check: ' + msg)) {
  const failed = [];
  for (const [what, fn] of steps) {
    try { fn(); } catch (e) { failed.push(what); report('could not ' + what + ': ' + (e && e.message || e)); }
  }
  return failed;
}

// A cleanup step that failed leaves the run's evidence incomplete (a run.json
// without its exit code, no record of the project's git state), so the run cannot
// count as valid on it; before runSteps such a failure stopped the run outright
// (review loop, R20).
function markCleanup(analysis, failed) {
  if (!failed.length) return analysis;
  analysis.valid = false;
  analysis.reasons.push('cleanup-failed');
  analysis.cleanupFailed = failed;
  return analysis;
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
  + 'Reaches: other installs none - one scratch copy; other sessions and unreleased work none - one scratch copy; what the user gets back: the count under each note. '
  + 'Models: cheap. Open questions: none.';

// The main checkout of this clone (the folder holding the shared .git), where the
// gitignored evidence lives, whichever worktree runs this script; else this one.
function mainCheckout() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, env: GIT_ENV, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? path.dirname(r.stdout.trim()) : REPO;
}

// The skeptic replay's two input folders, resolved and checked before anything
// is spent: a missing one is a usage error (exit 2).
function skepticInputs(o) {
  const root = mainCheckout();
  o.evidence = path.resolve(o.evidence || path.join(root, SKEPTIC_REPLAY.evidence));
  o.receipts = path.resolve(o.receipts || path.join(root, SKEPTIC_REPLAY.receipts));
  const log = path.join(o.evidence, SKEPTIC_REPLAY.session + '.jsonl');
  if (!fs.existsSync(log)) usage('--role skeptic needs the evidence folder that holds ' + path.basename(log) + ' (--evidence <dir>); not found in ' + o.evidence);
  if (!fs.existsSync(path.join(o.receipts, 'scope.json'))) usage('--role skeptic needs the replayed run\'s receipts folder with its scope.json (--receipts <dir>); not found in ' + o.receipts);
}

// The scratch project as the replayed review had it: a git checkout of the range
// end, and the plans its findings and receipt outputs cite. Session 1cefa1a7's
// skeptics ran `git log <base>..<end>` and read those plans; with a bare archive
// and no plans (they are gitignored), the first replay's skeptics searched the
// disk and read both from the owner's checkout. o { project, end, repo, plansFrom,
// texts }: `project` already holds the end's tree. This fetches the end's own
// history from `repo` into a fresh repo there (no remote, no tags, nothing after
// the end), and copies each cited plan from `plansFrom` with its modified time,
// since today's copy may postdate the dispatch. Returns what run.json records.
function replayCheckout(o) {
  const sha = git(['rev-parse', '--verify', o.end + '^{commit}'], o.repo);
  git(['init', '-q'], o.project);
  git(['fetch', '-q', '--no-tags', o.repo, sha], o.project);
  git(['update-ref', 'refs/heads/main', sha], o.project);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], o.project);
  git(['reset', '-q'], o.project);
  git(['checkout', '-q', '--', '.'], o.project); // restores any file the archive left out (export-ignore)
  const cited = [...new Set(o.texts.join('\n').match(/plans\/PLAN-[A-Za-z0-9._-]+\.md/g) || [])].sort();
  const plans = cited.map(rel => {
    const src = path.join(o.plansFrom, rel);
    if (!fs.existsSync(src)) return { path: rel, missing: true };
    fs.mkdirSync(path.join(o.project, 'plans'), { recursive: true });
    fs.copyFileSync(src, path.join(o.project, rel));
    const st = fs.statSync(src);
    return { path: rel, bytes: st.size, modified: st.mtime.toISOString() };
  });
  return { head: sha, commits: Number(git(['rev-list', '--count', 'HEAD'], o.project)), plans };
}

// The scratch project and the merge folder a skeptic replay hands the session,
// built from the evidence: o { evidence, receipts, project, tmp, buildDir }.
//   - the code the run reviewed: a git archive of its scope's range end, as the
//     mapper role archives its source commit;
//   - the finders' lines from the session log, Phase 3's one key merge applied,
//     the old project root rewritten to the scratch project, in findings.jsonl;
//   - the build's own merge-findings.js run on it (merged.jsonl, merge-stderr.txt),
//     as that build's Phase 3 runs it, and its numbering checked against the run's;
//   - tier 1's saved outputs for those lines and the scope, the root rewritten, in
//     the scratch project's reports/receipts/<the run's stamp>/.
//   - the range end's history and the cited plans, by replayCheckout above.
// Returns what run.json records as `replay`; throws on any mismatch, before a
// session starts.
function prepareSkepticReplay(o) {
  const scopeText = fs.readFileSync(path.join(o.receipts, 'scope.json'), 'utf8');
  const scope = JSON.parse(scopeText);
  const range = scope.range || {};
  if (!SHA_RE.test(String(range.base)) || !SHA_RE.test(String(range.end))) throw new Error('the saved scope.json names no commit range');
  const fromRoot = scope.root || scope.cwd;
  if (!fromRoot) throw new Error('the saved scope.json names no project root to rewrite');
  fs.mkdirSync(o.project, { recursive: true });
  const tar = path.join(o.tmp, 'source.tar');
  git(['archive', '-o', tar, range.end], REPO);
  const x = sh('tar', ['-xf', tar, '-C', o.project]);
  if (x.status !== 0) throw new Error('tar failed: ' + x.stderr);

  const found = finderLinesFromLog(readJsonl(path.join(o.evidence, SKEPTIC_REPLAY.session + '.jsonl')), SKEPTIC_REPLAY.firstDispatch);
  if (found.lines.length !== SKEPTIC_REPLAY.raw) throw new Error('the log gave ' + found.lines.length + ' finder lines, not the run\'s ' + SKEPTIC_REPLAY.raw);
  const shared = shareKeys(found.lines.map(l => l.text), SKEPTIC_REPLAY.keyMerges);
  const texts = shared.texts.map(t => rewriteRoot(t, fromRoot, o.project));

  const mergeDir = path.join(o.tmp, 'review-merge');
  fs.mkdirSync(mergeDir, { recursive: true });
  const findingsFile = path.join(mergeDir, 'findings.jsonl');
  fs.writeFileSync(findingsFile, texts.join('\n') + '\n');
  const m = sh(process.execPath, [path.join(o.buildDir, 'scripts', 'merge-findings.js'), findingsFile], { cwd: o.project });
  if (m.status !== 0) throw new Error('the build\'s merge-findings.js failed: ' + (m.stderr || m.stdout));
  fs.writeFileSync(path.join(mergeDir, 'merged.jsonl'), m.stdout);
  fs.writeFileSync(path.join(mergeDir, 'merge-stderr.txt'), m.stderr);
  const mergeSummary = (m.stderr.split('\n').filter(l => /^merge-findings: \d+ raw/.test(l)).pop() || '').trim();
  const canon = texts.map(t => JSON.stringify(JSON.parse(t)));
  const merged = m.stdout.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).map(f => ({
    id: f.id, severity: f.severity, specialist: f.specialist, sources: (f.sources || []).map(s => canon.indexOf(JSON.stringify(s))),
  }));
  if (merged.length !== SKEPTIC_REPLAY.merged || merged.some(f => !f.sources.length || f.sources.includes(-1))) {
    throw new Error('the build\'s merge gave ' + merged.length + ' findings (want ' + SKEPTIC_REPLAY.merged + ') or a source line it was not given');
  }

  const stampName = path.basename(o.receipts);
  const dest = path.join(o.project, 'reports', 'receipts', stampName);
  fs.mkdirSync(dest, { recursive: true });
  const stems = require(MERGE_FINDINGS).receiptStems(texts.map(t => JSON.parse(t)));
  const receiptTexts = [];
  for (const stem of stems) {
    const src = path.join(o.receipts, stem + '.txt');
    if (!fs.existsSync(src)) throw new Error('no saved receipt output ' + stem + '.txt in ' + o.receipts);
    const out = rewriteRoot(fs.readFileSync(src, 'utf8'), fromRoot, o.project);
    receiptTexts.push(out);
    fs.writeFileSync(path.join(dest, stem + '.txt'), out);
  }
  fs.writeFileSync(path.join(dest, 'scope.json'), rewriteRoot(scopeText, fromRoot, o.project));
  const checkout = replayCheckout({ project: o.project, end: range.end, repo: REPO, plansFrom: mainCheckout(), texts: texts.concat(receiptTexts) });
  return {
    session: SKEPTIC_REPLAY.session, firstDispatch: SKEPTIC_REPLAY.firstDispatch, evidence: o.evidence, receipts: o.receipts,
    stamp: stampName, range: { base: range.base, end: range.end }, fromRoot, mergeDir, mergeSummary,
    finders: found.finders, keyMerges: shared.notes, lines: texts, stems, merged, checkout,
  };
}

// The replay's prompt: the build's /tk:review, entered at Phase 4 with what the
// earlier phases left behind named, and a stop before the report and any fix.
// The final message is the record of each finding's verdict.
function skepticPrompt(r) {
  const receipts = 'reports/receipts/' + r.stamp;
  const short = s => String(s).slice(0, 7);
  const ran = r.finders.map(f => f.type.replace(/^(tk:)?review-|-finder$/g, ''));
  const none = r.finders.filter(f => f.noFindings).map(f => f.type.replace(/^(tk:)?review-|-finder$/g, ''));
  const merges = (r.keyMerges || []).map(k => 'The lines at ' + k.relPath + ':' + k.line + ' describe one defect, so before the merge each later one was given the first one\'s key (dedup note: merged at ' + k.relPath + ':' + k.line + ').').join(' ');
  const last = r.merged[r.merged.length - 1].id;
  return '/tk:review ' + short(r.range.base) + '..' + short(r.range.end) + ' report only, no chaining\n\n'
    + 'This run resumes a review at Phase 4; it is not a fresh review. Everything before Phase 4 is done, so do none of it again: no scope call, no detection, no finder dispatch, no tier 1 check.\n'
    + '- Phase 0: the run stamp is ' + r.stamp + ', and the scope call\'s JSON is saved at ' + receipts + '/scope.json.\n'
    + '- Phase 2: ' + ran.length + ' specialists ran (' + ran.join(', ') + ')' + (none.length ? '; ' + none.join(', ') + ' returned NO FINDINGS' : '') + '.\n'
    + '- Phase 3: the merge folder is ' + r.mergeDir + '. Its findings.jsonl holds the ' + r.lines.length + ' finding lines the finders returned, as they wrote them. ' + merges
    + ' merge-findings.js has run on that file: its stdout is merged.jsonl in the same folder (R1 to ' + last + '), and its summary line is: ' + r.mergeSummary + '\n'
    + '- Tier 1 of the audit has run: each receipt\'s output is saved as ' + receipts + '/<lens>-<n>.txt, and every check showed its claim, so tier 1 killed nothing.\n\n'
    + 'Run Phase 4 from here: the audit\'s remaining tiers, exactly as this command and M2 say, and decide every finding. Then stop: write no report, fix nothing, commit nothing. '
    + 'Your final message is one line per finding, `RN: <verdict>`, from R1 to ' + last + ', and nothing else.';
}

// The session's scratchpad, which Claude Code keeps outside the scratch home at
// <tmp>/claude-<uid>/<project slug>/: a runner may write its shards there with
// Bash, and then no transcript holds their bytes. Copied, never removed.
function copyScratchpads(home, out) {
  const projects = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(projects) || typeof process.getuid !== 'function') return;
  const bases = [...new Set([os.tmpdir(), '/tmp'])].map(t => path.join(t, 'claude-' + process.getuid()));
  for (const slug of fs.readdirSync(projects)) {
    const src = bases.map(b => path.join(b, slug)).find(p => fs.existsSync(p));
    if (src) copyDir(src, path.join(out, 'scratchpad', slug));
  }
}

async function commandRun(o) {
  const role = o.role;
  if (!['review', 'mapper', 'skeptic', 'fix', 'probe'].includes(role)) usage('--role must be review, mapper or skeptic, or fix (the oracle-checked fix run)');
  if (role === 'skeptic' || role === 'fix') {
    if (o.arm !== undefined || o.only || o.effort || o.modeWord !== undefined || o.planModels !== undefined) usage('--role ' + role + (role === 'skeptic' ? ' replays' : ' runs') + ' the build as it ships: it takes no --arm, --only, --effort, --mode-word or --plan-models');
    if (role === 'skeptic') skepticInputs(o);
  }
  if (o.oraclePort !== undefined && role !== 'fix') usage('--oracle-port applies to --role fix, --judge and --oracle-self-test');
  // The probes name Notebook's files and the mapper and skeptic read no fixture,
  // so only the review and fix roles take another one (#278).
  if (o.fixture !== DEFAULT_FIXTURE && role !== 'review' && role !== 'fix') usage('--fixture applies to --role review, --role fix and --oracle-self-test; the probes, the mapper and the skeptic replay run on ' + DEFAULT_FIXTURE);
  const fx = fixtureOrUsage(o.fixture);
  if (role !== 'probe' && role !== 'skeptic' && role !== 'fix' && !['a', 'b', 'c', 'h', 'ship'].includes(o.arm)) usage('--arm must be a, b, c, h or ship');
  if (o.only && (role === 'probe' || o.arm === 'ship')) usage('--only applies to a measured arm (a, b, c or h) of the review or mapper role');
  if (!o.build) usage('--build <git-ref|tree> is required');
  if (role === 'mapper' && !o.chunk) usage('--role mapper needs --chunk <manifest.json>');
  for (const m of [o.modeWord, o.planModels]) if (m !== undefined && !MODES.includes(m)) usage('a mode is best, fit or cheap');
  const budget = budgetCheck(role === 'probe' ? 'probe' : role, o.maxUsd);
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
  const onlyTag = o.only ? '-only-' + o.only.map(n => n.replace(/^review-|-finder$/g, '')).join('+') : '';
  const kind = role === 'probe' ? 'probe-' + o.probe + (o.modeWord ? '-' + o.modeWord : '') : role === 'skeptic' || role === 'fix' ? role : role + '-' + o.arm + onlyTag + modeTag;
  const out = path.join(OUT_ROOT, runDirName({ stamp: stamp(), kind, build: buildLabel, fixture: o.fixture, label: o.label }));
  fs.mkdirSync(out, { recursive: true });
  // Opus, except the probe that checks /execute's note on a session running on
  // another model than the plan's build model.
  const sessionModel = o.probe === 'execute-mismatch' ? 'sonnet' : SESSION_MODEL;
  const sessionFamily = familyOf(sessionModel);
  const meta = {
    version: 1, role, arm: o.arm || null, only: o.only || null, label: o.label || '', probe: o.probe || null,
    build: { spec: o.build, sha: build.sha, version: build.version, pathHashes: buildPathHashes(build.dir) },
    session: { model: sessionModel, effort: SESSION_EFFORT, permissionMode: 'bypassPermissions', maxUsd: o.maxUsd, systemNote: SYSTEM_NOTE, claude: claudeVersion() },
    paths: { tmp, home, project, buildDir: build.dir },
    expect: { main: sessionFamily, finders: sessionFamily, mapper: sessionFamily },
    ...fixtureRecord(o.fixture), startedAt: new Date().toISOString(),
  };
  // Where the oracles start the judged tree's server, after the session's own
  // fixture server has stopped.
  const oraclePort = o.oraclePort || PORT;
  if (role === 'fix') meta.oraclePort = oraclePort;
  let serverPid = null;
  let envExtra = {};
  // From the session's start the run may have spent money, so from then on a
  // ledger line is written however the run ends (review R14).
  let ran = false;
  let reportedCost = null;
  let sessionDone = false;
  let cleanupFailed = [];
  const enterLedger = valid => appendLedger(ledgerRow(meta, ledgerCost(reportedCost, o.maxUsd), valid, path.relative(REPO, out)));
  try {
    if (role === 'review' || role === 'fix' || (role === 'probe' && o.probe === 'review')) {
      // The fix role runs the finders as the build ships them (the ship arm's settings).
      const settings = role === 'review' ? armSettings('review', o.arm, build, o.effort, o.only)
        : role === 'fix' ? armSettings('review', 'ship', build, null) : armSettings('review', 'a', build, null);
      applyArm(settings);
      meta.patch = settings.filter(s => !s.shipped).map(s => ({ agent: s.name, before: s.before, model: s.model, effort: s.effort }));
      // The agents the arm left as shipped (all of them on the ship arm, the rest
      // of the finders under --only), so the score's arm line reads them from here.
      if (settings.some(s => s.shipped)) meta.shipped = settings.filter(s => s.shipped).map(s => ({ agent: s.name, model: s.model, effort: s.effort }));
      // Where each finder should answer: the mode the review resolves (see Model modes).
      const mode = o.modeWord || o.planModels || 'fit';
      meta.expect.finderModels = finderModels(mode, build.dir, sessionFamily);
      const fams = [...new Set(Object.values(meta.expect.finderModels))];
      meta.expect.finders = fams.length === 1 ? fams[0] : null;
      if (o.arm === 'ship' || o.modeWord || o.planModels) {
        meta.expect.modeLine = { mode, from: o.modeWord ? 'mode:? ?word|argument' : o.planModels ? 'PLAN-fixture' : 'default' };
      }
      const commits = buildReviewProject(project, o.planModels || null, fx);
      meta.commits = commits;
      meta.lenses = role === 'review' || role === 'fix' ? FINDER_KINDS : ['code'];
      const lensArg = meta.lenses.join(',');
      const modeWord = o.modeWord ? ' mode:' + o.modeWord : '';
      meta.prompt = role === 'fix' ? fixPrompt(meta.lenses, commits.base) : '/tk:review ' + lensArg + ' ' + commits.base + '..HEAD' + modeWord + ' report only, no chaining';
      // The loop commits each green fix (M4); the scratch home has no git
      // identity, so the project carries one, as a real project would.
      if (role === 'fix') for (const [k, v] of [['user.name', loadAnswers(o.fixture).app.name + ' Dev'], ['user.email', 'dev@example.com'], ['commit.gpgsign', 'false']]) git(['config', k, v], project);
      serverPid = await startServer(project);
    } else if (role === 'mapper') {
      const chunk = JSON.parse(fs.readFileSync(path.resolve(o.chunk), 'utf8'));
      meta.chunk = { file: path.relative(REPO, path.resolve(o.chunk)), sourceRef: chunk.sourceRef, files: chunk.files };
      const settings = armSettings('mapper', o.arm, build, o.effort, o.only);
      applyArm(settings);
      meta.patch = settings.filter(s => !s.shipped).map(s => ({ agent: s.name, before: s.before, model: s.model, effort: s.effort }));
      // The agents the arm left as shipped (all of them on the ship arm, the rest
      // of the finders under --only), so the score's arm line reads them from here.
      if (settings.some(s => s.shipped)) meta.shipped = settings.filter(s => s.shipped).map(s => ({ agent: s.name, model: s.model, effort: s.effort }));
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
    } else if (role === 'skeptic') {
      // No arm: the skeptics run on the build's own agent file, which inherits
      // the session model, so the expectation is the session's family.
      meta.replay = prepareSkepticReplay({ evidence: o.evidence, receipts: o.receipts, project, tmp, buildDir: build.dir });
      meta.prompt = skepticPrompt(meta.replay);
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
      meta.commits = buildReviewProject(project, null, fx);
      meta.expect.mapper = mapperModel(mode, build.dir, sessionFamily);
      meta.expect.byType = { 'tk:index-mapper': meta.expect.mapper };
      meta.expect.modeLine = { mode };
      meta.prompt = '/tk:index' + (o.modeWord ? ' mode:' + o.modeWord : '');
    } else if (o.probe === 'review-code-mode') {
      // A direct /tk:review-code on four changed files takes the bigger-change path
      // and fans out to review-code-finder calls, each on the mode's model.
      const mode = o.modeWord || 'fit';
      const commits = buildReviewProject(project, null, fx);
      meta.commits = commits;
      meta.expect.finderModels = finderModels(mode, build.dir, sessionFamily);
      meta.expect.byType = { 'tk:review-code-finder': meta.expect.finderModels.code };
      meta.expect.modeLine = { mode };
      meta.prompt = '/tk:review-code' + (o.modeWord ? ' mode:' + o.modeWord : '') + ' the changes in ' + commits.base
        + '..HEAD to server.js, public/app.js, scripts/import-notes.js and scripts/rotate-backups.sh; report only, no chaining';
    } else if (o.probe === 'execute-mismatch') {
      // A Sonnet session builds a plan whose Models line is fit: /tk:execute notes in
      // one line that the plan builds on Opus, gives the fresh-session steps, and carries on.
      meta.commits = buildReviewProject(project, null, fx);
      addMismatchPlan(project);
      meta.expect.texts = ['builds on\\W{0,4}Opus', '/model opus'];
      meta.prompt = '/tk:execute no chaining';
    } else if (o.probe === 'create-plan-cheap') {
      // /tk:create-plan from a summary naming cheap: the plan's Models line, the
      // critic on the session model, and the fresh-session close. With no map yet,
      // it runs /index mode:cheap first, so a mapper may answer too, on Sonnet.
      meta.commits = buildReviewProject(project, null, fx);
      meta.expect.byType = { 'tk:plan-critic': sessionFamily };
      meta.expect.mapper = mapperModel('cheap', build.dir, sessionFamily);
      meta.expect.planLine = { mode: 'cheap', skip: ['PLAN-fixture.md'] };
      meta.expect.lastText = ['/model opus'];
      meta.prompt = '/tk:create-plan ' + PLAN_SUMMARY;
    } else {
      usage('unknown probe ' + o.probe);
    }
    const env = sessionEnv(tmp, envExtra);
    // What the session may not reach, recorded beside the run (#277).
    Object.assign(meta, { restrictions: restrictionsRecord('/tmp', env.strippedNames) });
    fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log('quality-check: ' + kind + ' on ' + o.build + ' (' + build.version + ') -> ' + path.relative(REPO, out));
    console.log('quality-check: ' + budget.note);
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
    cleanupFailed = runSteps([
      ['stop the fixture server', () => stopServer(serverPid)],
      ['stop what the session left running', () => {
        if (role !== 'fix') return;
        const left = processesUnder(tmp).filter(p => p.pid !== serverPid);
        if (!left.length) return;
        meta.leftovers = left;
        for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); } catch (e) { /* already gone */ } }
        console.log('quality-check: stopped ' + left.length + ' process' + (left.length === 1 ? '' : 'es') + ' the session left running in the scratch folder: ' + left.map(p => p.cmd || p.pid).join(' | '));
      }],
      ['copy the transcripts', () => copyDir(path.join(home, '.claude', 'projects'), path.join(out, 'transcripts'))],
      ['copy the project reports', () => copyDir(path.join(project, 'reports'), path.join(out, 'project-reports'))],
      ['copy the project plans', () => copyDir(path.join(project, 'plans'), path.join(out, 'project-plans'))],
      ['copy review.html', () => {
        if (fs.existsSync(path.join(project, 'artifacts', 'html', 'review.html'))) fs.copyFileSync(path.join(project, 'artifacts', 'html', 'review.html'), path.join(out, 'review.html'));
      }],
      ['record the project\'s git state', () => {
        if (!fs.existsSync(path.join(project, '.git'))) return;
        const st = sh('git', ['status', '--porcelain'], { cwd: project, env: GIT_ENV });
        const lg = sh('git', ['log', '--oneline', '-5'], { cwd: project, env: GIT_ENV });
        fs.writeFileSync(path.join(out, 'project-git.json'), JSON.stringify({ status: st.stdout, log: lg.stdout }, null, 2) + '\n');
      }],
      // A fix run's final tree, which the oracles judge below, and its fixes diff.
      ['copy the final project tree', () => { if (role === 'fix' && fs.existsSync(project)) copyTree(project, path.join(out, 'project-final')); }],
      ['record the fixes diff', () => {
        if (role === 'fix' && meta.commits && fs.existsSync(path.join(project, '.git'))) fs.writeFileSync(path.join(out, 'fix-diff.patch'), fixDiff(project, meta.commits.change));
      }],
      // A skeptic replay's inputs outside the project, read back when it is scored.
      ['copy the replay\'s merge folder', () => { if (role === 'skeptic' && meta.replay) copyDir(meta.replay.mergeDir, path.join(out, 'replay-merge')); }],
      ['copy the session scratchpad', () => { if (role === 'skeptic') copyScratchpads(home, out); }],
      ['write run.json', () => fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(meta, null, 2) + '\n')],
      ['remove the scratch folder', () => { if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true }); }],
      // A run that broke after its session started still enters its spend.
      ['enter the ledger line', () => { if (ran && !sessionDone) enterLedger(false); }],
    ]);
  }
  // The oracles judge the fix run's final tree. A judge that breaks is recorded,
  // never thrown: the run's ledger line below must still be written, and --judge
  // can judge the saved tree again.
  if (role === 'fix' && !interrupted) {
    let judged;
    try {
      const tree = path.join(out, 'project-final');
      if (!fs.existsSync(tree)) throw new Error('no project-final/ was saved');
      console.log('quality-check: judging the final tree with the oracles, servers on port ' + oraclePort);
      judged = await judgeTree(tree, oraclePort, { fixture: o.fixture });
    } catch (e) {
      judged = { port: oraclePort, at: new Date().toISOString(), error: String(e && e.message || e) };
      console.error('quality-check: the oracles could not judge the run: ' + judged.error);
    }
    try { fs.writeFileSync(path.join(out, 'oracles.json'), JSON.stringify(judged, null, 2) + '\n'); }
    catch (e) { console.error('quality-check: could not write oracles.json: ' + e.message); }
  }
  let analysis = null;
  try {
    analysis = markCleanup(analyzeRun(loadRun(out), loadAnswers(o.fixture)), cleanupFailed);
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
  console.log('Run: ' + path.relative(REPO, a.dir) + ' (fixture ' + (a.fixtureName || DEFAULT_FIXTURE) + ')');
  console.log('  valid: ' + (a.valid ? 'yes' : 'NO (' + a.reasons.join(', ') + ')') + (a.warnings.length ? '; warnings: ' + a.warnings.join(', ') : ''));
  console.log('  cost: ' + money(a.costUsd) + ', time: ' + mins(a.wallMs) + ', turns: ' + (a.turns || 'n/a'));
  if (a.models) console.log('  models: main ' + a.models.main.join('+') + '; ' + Object.entries(a.models.byType).map(([t, m]) => t.replace(/^tk:/, '') + ' ' + m.join('+')).join('; '));
  for (const c of a.checks || []) console.log('  check ' + c.name + ': ' + (c.ok ? 'ok' : 'FAILED') + ' - ' + c.detail);
  if (a.outside) console.log('  outside reads: ' + a.outside.join(' | '));
  if (a.restrictions) console.log('  restrictions: tools off ' + a.restrictions.disallowedTools.join(',') + '; env stripped ' + (a.restrictions.strippedEnv.length ? a.restrictions.strippedEnv.join(',') : 'none') + '; /tmp entries at start ' + a.restrictions.tmpBefore.length + (a.restrictions.tmpBeforeTruncated ? ' (list cut at the cap)' : ''));
  for (const l of leakLines(a)) console.log('  ' + l);
  if (a.survived) {
    console.log('  findings in report: ' + a.survivorCount + ' surviving, ' + a.killedCount + ' audited out; contract breaks: ' + a.contractBreaks + '; prose wrapped around JSONL: ' + (a.wrapped || 0));
    for (const id of Object.keys(a.survived)) {
      const k = a.killedAs && a.killedAs[id];
      console.log('    ' + id.padEnd(26) + ' raised ' + String(a.raised[id].length).padEnd(2) + ' survived ' + (a.survived[id].length ? 'yes (' + a.survived[id].map(e => e.id).join(',') + ')' : 'no')
        + (k ? '  killed: ' + k.category + (k.kills.length ? ' (' + k.kills.map(x => x.id + ' ' + (x.verdict || '?')).join(', ') + ')' : '') : ''));
      if (verbose && k) for (const x of k.kills) console.log('        audited out ' + x.id + ': ' + x.reason);
      if (verbose) {
        for (const r of a.raised[id]) console.log('        raised [' + r.kind + '] ' + r.what);
        for (const e of a.survived[id]) console.log('        report ' + e.text);
      }
    }
    if (a.harnessLost) console.log('  harness-lost (the runner refused the check, so it never ran): ' + a.harnessLost.length + (a.harnessLost.length ? ' (' + a.harnessLost.join(', ') + ')' : ''));
    if (verbose) {
      console.log('  matched no planted bug (check by eye that none is a missed catch):');
      for (const r of a.unmatchedRaw) console.log('    raw [' + r.kind + '] ' + r.file + ' ' + r.what);
      for (const e of a.unmatchedSurvivors) console.log('    report ' + e.text);
    }
  }
  if (a.role === 'mapper' && a.mapper) console.log('  mapper: ' + JSON.stringify(a.mapper));
  if (a.role === 'fix' && a.fix) {
    const f = a.fix;
    console.log('  fix loop: ' + f.digestLines + ' Digest line' + (f.digestLines === 1 ? '' : 's') + ', ' + f.verifierDispatches + ' fix-verifier dispatch' + (f.verifierDispatches === 1 ? '' : 'es')
      + '; oracles: ' + (f.oraclePort ? 'judged with servers on port ' + f.oraclePort : 'NOT JUDGED' + (f.judgeError ? ' (' + f.judgeError + ')' : '')));
    console.log('    ' + 'bug'.padEnd(26) + 'raised  report        run said     gone      works     outcome');
    for (const [id, b] of Object.entries(f.bugs)) {
      console.log('    ' + id.padEnd(26) + (b.raised ? 'yes' : 'no').padEnd(8) + (b.inReport.join(',') || '-').padEnd(14) + (b.said || '-').padEnd(13)
        + (b.gone || '-').padEnd(10) + (b.works || '-').padEnd(10) + b.outcome + (b.falseFixed ? '  FALSE FIXED' : ''));
      for (const l of [b.goneLine, b.worksLine]) if (l) console.log('        ' + l);
    }
    console.log('  false FIXED (the run said FIXED; the oracles do not pass both): ' + (f.falseFixed.length ? f.falseFixed.join(', ') : 'none'));
    if (f.unjudged.length || !f.oraclePort) console.log('  judge again: node scripts/quality-check.js --judge ' + path.relative(REPO, a.dir) + ' [--oracle-port <n>]');
  }
  if (a.role === 'skeptic' && a.skeptic) {
    const s = a.skeptic.summary;
    const ids = list => (list.length ? list.join(', ') : 'none');
    const span = d => (d.ids.length ? d.ids[0] + (d.ids.length > 1 ? '-' + d.ids[d.ids.length - 1] + ' (' + d.ids.length + ')' : '') : 'no IDs');
    console.log('  skeptic dispatches:');
    for (const d of a.skeptic.dispatches) {
      console.log('    D' + d.n + ' ' + d.type + ' tier ' + d.tier + ' ' + span(d) + ': ' + d.class + (d.file ? ' (' + d.file + ')' : '')
        + ', lines ' + d.linesFound + '/' + d.ids.length + ' byte for byte, asks ' + (d.asks.length ? d.asks.join('/') : 'no verdict words') + (d.m2Words ? ' (M2)' : ' (not M2)')
        + '; return ' + (!d.returned ? 'none' : d.returnOk === null ? 'unchecked' : d.returnOk ? 'clean' : 'flagged: ' + d.problems.join(', ')));
    }
    console.log('  summary: ' + s.dispatches + ' dispatches, ' + s.byteForByte + ' byte for byte (' + s.script + ' script, ' + s.verbatim + ' verbatim), '
      + s.paraphrased + ' paraphrased, ' + s.unknown + ' unknown; returns ' + s.returnsClean + ' clean, ' + s.returnsFlagged + ' flagged, ' + s.returnsUnchecked + ' unchecked; '
      + s.otherWords + ' asked for words outside M2; --verdicts calls ' + s.verdictsCalls + ' (' + s.verdictsRejected + ' rejected)');
    console.log('  recorded verdicts: ' + s.recorded + '; ruled on from a paraphrase: ' + ids(s.ruledFromParaphrase)
      + (s.ruledFromUnknown.length ? '; from an unreadable dispatch: ' + ids(s.ruledFromUnknown) : '')
      + (s.notJudged.length ? '; recorded with no skeptic ruling: ' + ids(s.notJudged) : ''));
    console.log('  drift reproduced: ' + (s.drift ? 'yes (a paraphrased dispatch)' : 'no'));
  }
}

// Every saved run under `root` whose role is `role` and whose fixture is
// `fixtureName`, analyzed with its setting: the pool the noise lines draw from. A
// folder that does not load is skipped.
function loadPool(root, role, answers, fixtureName) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    const meta = readJson(path.join(dir, 'run.json'));
    if (!meta || meta.role !== role || runFixtureName(meta) !== fixtureName) continue;
    try {
      const run = loadRun(dir);
      out.push(Object.assign(analyzeRun(run, answers), { setting: runSetting(run) }));
    } catch (e) { /* a torn folder is not part of the pool */ }
  }
  return out;
}

function commandScore(o) {
  // One answer key scores every run, so the runs must share a fixture (#278).
  const dirs = [...o.score, o.against].flatMap(list => list.split(',').map(s => s.trim()).filter(Boolean)).map(d => path.resolve(d));
  const names = knownValues(dirs.map(d => runFixtureName(readJson(path.join(d, 'run.json'))))).sort();
  if (names.length > 1) usage('the runs are on different fixtures (' + names.join(', ') + '): a score compares runs of one fixture');
  const fixtureName = names[0] || DEFAULT_FIXTURE;
  const answers = loadAnswers(fixtureName);
  const load = list => list.split(',').map(s => s.trim()).filter(Boolean).map(d => {
    const run = loadRun(path.resolve(d));
    return Object.assign(analyzeRun(run, answers), { setting: runSetting(run) });
  });
  const baseline = load(o.against);
  const role = baseline[0] && baseline[0].role;
  const ids = role === 'mapper'
    ? ((loadRun(path.resolve(o.against.split(',')[0])).meta.chunk || {}).files || [])
    : answers.bugs.map(b => b.id);
  const knownId = (answers.bugs.find(b => b.knownAnswer) || {}).id;
  const poolRoot = path.resolve(o.pool || OUT_ROOT);
  const pool = loadPool(poolRoot, role, answers, fixtureName);
  const results = o.score.map(set => {
    const candidate = load(set);
    const s = scoreSets(candidate, baseline, ids, { knownId, requireKnown: o.requireKnown, allowDrift: o.allowDrift, pool });
    s.settings = { candidate: candidate.map(x => x.setting), baseline: baseline.map(x => x.setting) };
    return { set, s };
  });
  if (o.json) { console.log(JSON.stringify(results, null, 2)); return; }
  const short = d => path.basename(d);
  for (const { set, s } of results) {
    console.log('Candidate: ' + set);
    console.log('Baseline:  ' + o.against);
    console.log('  runs: baseline ' + s.baselineValid + '/' + s.baselineRuns + ' valid, candidate ' + s.candidateValid + '/' + s.candidateRuns + ' valid');
    for (const inv of s.invalid) console.log('  invalid: ' + path.relative(REPO, inv.dir) + ' (' + inv.reasons.join(', ') + ')');
    for (const side of ['candidate', 'baseline']) {
      for (const st of s.settings[side]) {
        const l = settingLines(st);
        console.log('  harness ' + side.padEnd(9) + ' ' + short(st.dir) + ': ' + l.harness);
        console.log('  arm     ' + side.padEnd(9) + ' ' + short(st.dir) + ': ' + l.arm);
      }
    }
    if (s.compare) console.log('  comparison: ' + (s.compare.confounded ? 'CONFOUNDED: ' : '') + s.compare.summary);
    if (s.drift) console.log('  DRIFT ALLOWED (--allow-drift): ' + s.drift.reason + ' [confounds: ' + s.drift.confounds.join('; ') + ']');
    else if (o.allowDrift && s.compare && !s.compare.confounded) console.log('  --allow-drift given (' + o.allowDrift + '), not needed: nothing confounds this comparison');
    console.log('  stable (' + s.stable.length + '): ' + (s.stable.join(', ') || 'none'));
    if (s.noisy.length) console.log('  noisy, not scored (' + s.noisy.length + '): ' + s.noisy.join(', '));
    if (s.never.length) console.log('  never caught by the baseline (' + s.never.length + '): ' + s.never.join(', '));
    if (role !== 'mapper') {
      console.log('  ' + 'bug'.padEnd(26) + 'baseline  candidate  raised(candidate)  harness-lost(candidate)');
      for (const [id, p] of Object.entries(s.perId)) console.log('  ' + id.padEnd(26) + p.baseline.padEnd(10) + p.candidate.padEnd(11) + p.raisedCandidate.padEnd(19) + p.harnessLost);
      // Which run lost which bug to the harness, and through which Audited out entry.
      for (const l of s.harnessLostRuns) console.log('  harness-lost: ' + l.id + ' in ' + short(l.dir) + ' (' + l.kills.join(', ') + ')');
    }
    if (Object.keys(s.noise).length) {
      console.log('  noise: each stable catch across the ' + s.poolRuns + ' saved valid run' + (s.poolRuns === 1 ? '' : 's') + ' on the baseline\'s setting (' + path.relative(REPO, poolRoot) + '):');
      for (const [id, n] of Object.entries(s.noise)) console.log('    ' + id.padEnd(26) + n.caught + '/' + n.runs + (n.caught < n.runs ? '  (the baseline setting drops it)' : ''));
    }
    console.log('  cost per run: baseline ' + money(s.baselineCostUsd) + ', candidate ' + money(s.costUsd) + '; time: baseline ' + mins(s.baselineWallMs) + ', candidate ' + mins(s.wallMs));
    console.log('  VERDICT: ' + s.verdict + (s.why.length ? ' - ' + s.why.join('; ') : '') + (s.drift ? ' (drift allowed: ' + s.drift.reason + ')' : ''));
    console.log('');
  }
  const passing = results.filter(r => r.s.verdict === 'PASS' && typeof r.s.costUsd === 'number').sort((x, y) => x.s.costUsd - y.s.costUsd);
  if (results.length > 1) console.log('Cheapest passing set: ' + (passing.length ? passing[0].set + ' (' + money(passing[0].s.costUsd) + ' per run)' : 'none'));
}

// --oracle-self-test: the oracles on the change tree with no fix (every gone oracle
// must FAIL), then on one tree holding a correct fix for the key's selfTestPair.correct
// and an empty fix for its selfTestPair.deletion (correct: gone and works PASS; empty:
// gone PASS, works FAIL), then each runnable bug's correct and empty fix alone.
// No session, no ledger line; servers on a free port other than PORT. --fixture
// chooses the fixture (notebook unless given).
async function commandOracleSelfTest(o) {
  const fx = fixtureOrUsage(o.fixture);
  const answers = loadAnswers(o.fixture);
  const set = oracleSet(answers, path.join(fx, 'oracles'));
  const fixes = require(path.join(fx, 'oracles', 'self-test-fixes.js'));
  const pairIds = answers.selfTestPair || {};
  if (!set[pairIds.correct] || !set[pairIds.deletion] || pairIds.correct === pairIds.deletion) usage('the answer key\'s selfTestPair must name two different runnable bugs: ' + JSON.stringify(answers.selfTestPair || null));
  const port = o.oraclePort || await freePort();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-oracle-self-test.'));
  let checks = 0;
  const failed = [];
  const want = (stage, id, kind, wanted, got) => {
    const ok = wanted === null || got.verdict === wanted;
    if (wanted !== null) { checks++; if (!ok) failed.push(stage + ' ' + id + ' ' + kind); }
    console.log('  ' + (wanted === null ? '[ref]' : ok ? '[ok] ' : '[BAD]') + ' ' + stage.padEnd(9) + id.padEnd(24) + ' ' + kind.padEnd(6) + got.verdict.padEnd(9)
      + (wanted === null ? '(reference)  ' : '(want ' + wanted + ')').padEnd(14) + got.line);
  };
  const judge = async (stage, tree, wants) => {
    await judgeTree(tree, port, { fixture: o.fixture, answers, only: Object.keys(wants), onResult: (id, kind, r) => want(stage, id, kind, wants[id][kind], r) });
  };
  try {
    console.log('Oracle self-test: servers on port ' + port + '; playwright-core: ' + (playwrightCore() || 'none (the browser oracles will be UNJUDGED)'));
    const unfixed = path.join(work, 'unfixed');
    copyFixture(path.join(fx, 'base'), unfixed);
    copyFixture(path.join(fx, 'change'), unfixed);
    for (const id of Object.keys(set)) if (!fixes[id] || !fixes[id].correct || !fixes[id].deletion) failed.push('no self-test fixes for ' + id);

    console.log('\n1. The change tree with no fix: every gone oracle FAILs (works shown for reference)');
    await judge('unfixed', unfixed, Object.fromEntries(Object.keys(set).map(id => [id, { gone: 'FAIL', works: null }])));

    const pair = path.join(work, 'pair');
    copyTree(unfixed, pair);
    applyEdits(pair, fixes[pairIds.correct].correct);
    applyEdits(pair, fixes[pairIds.deletion].deletion);
    console.log('\n2. One tree: a correct fix for ' + pairIds.correct + ', an empty fix (the cited lines deleted) for ' + pairIds.deletion);
    await judge('pair', pair, { [pairIds.correct]: { gone: 'PASS', works: 'PASS' }, [pairIds.deletion]: { gone: 'PASS', works: 'FAIL' } });

    console.log('\n3. Each runnable bug alone: its correct fix passes both; its empty fix passes gone and fails works');
    for (const id of Object.keys(set)) {
      for (const [shape, wants] of [['correct', { gone: 'PASS', works: 'PASS' }], ['deletion', { gone: 'PASS', works: 'FAIL' }]]) {
        if (!fixes[id] || !fixes[id][shape]) continue;
        const tree = path.join(work, id + '-' + shape);
        copyTree(unfixed, tree);
        applyEdits(tree, fixes[id][shape]);
        await judge(shape, tree, { [id]: wants });
        fs.rmSync(tree, { recursive: true, force: true });
      }
    }
    console.log('\nNot runnable (no oracle pair):');
    for (const [id, why] of Object.entries(notRunnable(answers))) console.log('  ' + id.padEnd(24) + ' ' + why);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log('\nOracle self-test: ' + (checks - failed.filter(f => !/^no self-test fixes/.test(f)).length) + ' of ' + checks + ' verdicts as wanted' + (failed.length ? '; FAILED: ' + failed.join(', ') : ''));
  process.exit(failed.length ? 1 : 0);
}

// --judge: the oracles again on a saved fix run's final tree (a busy port, a
// missing browser), then the run re-analyzed. No session, no cost.
async function commandJudge(o) {
  const dir = path.resolve(o.judge);
  const meta = readJson(path.join(dir, 'run.json'));
  if (!meta || meta.role !== 'fix') usage('--judge needs a fix run folder (its run.json says role fix): ' + dir);
  const tree = path.join(dir, 'project-final');
  if (!fs.existsSync(tree)) usage('--judge needs the run\'s project-final/ folder, not found in ' + dir);
  const judged = await judgeTree(tree, o.oraclePort || PORT, { fixture: runFixtureName(meta) });
  fs.writeFileSync(path.join(dir, 'oracles.json'), JSON.stringify(judged, null, 2) + '\n');
  const a = checkRun(dir).analysis;
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(a, null, 2) + '\n');
  printRunSummary(a, false);
}

function commandBudget() {
  const rows = ledger();
  const spent = rows.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const approval = readJson(BUDGET);
  for (const r of rows) console.log((r.at || '').slice(0, 19) + '  ' + String(r.role + (r.arm ? '-' + r.arm : '') + (r.probe ? '-' + r.probe : '') + (r.fixtureName && r.fixtureName !== DEFAULT_FIXTURE ? ' ' + r.fixtureName : '')).padEnd(22) + String(r.build).padEnd(10) + (money(r.costUsd) + (r.costCapped ? '*' : '')).padEnd(9) + (r.valid ? 'valid' : 'INVALID') + '  ' + r.dir);
  if (rows.some(r => r.costCapped)) console.log('* no cost reported (a timeout, a crash, an interrupt): entered at the run\'s cap');
  console.log('spent: ' + money(spent) + '; approved: ' + (approval ? money(approval.approvedUsd) + ' (' + approval.at + ')' : 'none yet'));
}

function usage(msg) {
  if (msg) console.error('quality-check: ' + msg);
  console.error('usage: see the header of scripts/quality-check.js');
  process.exit(2);
}

// The chosen fixture's folder, or a usage error (exit 2) naming the fixtures.
function fixtureOrUsage(name) {
  try { return fixtureDir(name || DEFAULT_FIXTURE); } catch (e) { return usage(e.message); }
}

function parseArgs(argv) {
  const o = { score: [], maxUsd: null, fixture: DEFAULT_FIXTURE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(a + ' needs a value'); return argv[++i]; };
    if (a === '--role') o.role = val();
    else if (a === '--arm') o.arm = val();
    else if (a === '--only') o.only = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--build') o.build = val();
    else if (a === '--effort') o.effort = val();
    else if (a === '--chunk') o.chunk = val();
    else if (a === '--evidence') o.evidence = val();
    else if (a === '--receipts') o.receipts = val();
    else if (a === '--label') o.label = val();
    else if (a === '--max-usd') o.maxUsd = Number(val());
    else if (a === '--mode-word') o.modeWord = val();
    else if (a === '--plan-models') o.planModels = val();
    else if (a === '--keep') o.keep = true;
    else if (a === '--fixture') { o.fixture = val(); o.fixtureGiven = true; }
    else if (a === '--score') o.score.push(val());
    else if (a === '--against') o.against = val();
    else if (a === '--require-known') o.requireKnown = true;
    else if (a === '--allow-drift') { o.allowDrift = val().trim(); if (!o.allowDrift) usage('--allow-drift needs a reason, which the score prints'); }
    else if (a === '--pool') o.pool = val();
    else if (a === '--json') o.json = true;
    else if (a === '--check') o.check = val();
    else if (a === '--probe') o.probe = val();
    else if (a === '--budget') o.budget = true;
    else if (a === '--approve') o.approve = Number(val());
    else if (a === '--judge') o.judge = val();
    else if (a === '--oracle-self-test') o.oracleSelfTest = true;
    else if (a === '--oracle-port') {
      o.oraclePort = Number(val());
      if (!Number.isInteger(o.oraclePort) || o.oraclePort < 1 || o.oraclePort > 65535) usage('--oracle-port needs a port number');
    }
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
  if (o.oracleSelfTest) return commandOracleSelfTest(o);
  // A saved run's record names its fixture (#278), so these take no flag.
  for (const [given, name] of [[o.judge, '--judge'], [o.check, '--check'], [o.score.length, '--score']]) {
    if (given && o.fixtureGiven) usage(name + ' reads the fixture from the run\'s record; it takes no --fixture');
  }
  if (o.judge) return commandJudge(o);
  if (o.check) {
    const a = checkRun(path.resolve(o.check)).analysis;
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
    buildReviewProject(project, null, fixtureDir(DEFAULT_FIXTURE));
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
  runGroup, ledgerCost, runSteps, markCleanup, LOOPBACK_PRELOAD, budgetEstimate, DEFAULT_MAX_USD,
  auditVerdict, stripArmLines, pathHash, dirPathFiles, gitPathFiles, runSetting, armOf, compareSettings, sameSetting,
  settingLines, mapperPromptHash, PATH_FILES,
  SKEPTIC_REPLAY, handbackBody, agentReturns, finderLinesFromLog, shareKeys, rewriteRoot, namedFiles, idsIn,
  verdictAsks, instructionText, scoreDispatch, localCopyOf, recordedVerdicts, skepticPrompt, replayCheckout, prepareSkepticReplay,
  notRunnable, oracleSet, parseDigest, verifierVerdicts, fixOutcome, fixPrompt,
  copyTree, judgeTree, applyEdits, freePort, fixDiff, processesUnder, PORT,
  FIXTURES_ROOT, DEFAULT_FIXTURE, ORACLE_LIB, fixtureNames, fixtureDir, fixtureHash, loadAnswers, parseArgs,
  fixtureRecord, runDirName, ledgerRow, runFixtureName, checkRun,
  DISALLOWED_TOOLS, stripSecrets, tmpSnapshot, restrictionsRecord, sessionEnv, sessionArgs, leakLines,
};

if (require.main === module) {
  main().catch(e => { console.error('quality-check: ' + (e && e.stack || e)); process.exit(1); });
}
