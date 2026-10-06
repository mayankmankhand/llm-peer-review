---
name: upgrade
description: After a plugin update (or right after a /tk:setup migration), audit this project's own commands, skills, agents, rules, CLAUDE.md and the other files its sessions read against the toolkit conventions that changed since the last audited version, plus the ones checked on every upgrade, and fix what drifted through the normal audit and auto-fix loop.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Agent
  - Skill
  - "Bash(gh issue create *)"
  - "Bash(glab issue create *)"
  - "Bash(mktemp -d /tmp/*)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/session-init.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js)"
---

# Upgrade

**Use this when:** The toolkit plugin moved to a new version, in every project on the plugin: the checks that run on every upgrade read the rules file, the settings and the seeded files every project has, and the closing stamp is what clears the session notice. Also when `/tk:setup` just migrated a copy-install and handed off here.
**Don't use this when:** The project is not on the plugin yet (`/tk:setup` first), or you are inside the toolkit's own repository.

Every convention this run checks is written down once, with its id, the version it arrived in, the signal that finds a file behind it, and the shape of the fix:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/conventions.md"`

## Critical Rules

<rules>

1. **The script finds, the loop judges.** Candidates come from `node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js` plus your own pass over the `manual` conventions. You are M2's runner: every candidate is audited before anything is fixed, and a hit that turns out to be the project's own file dies there with its receipt.
2. **Prompt-file edits page once, as a batch (M9).** The files this run edits are the project's own commands, skills, agents, and rules, which are always-ask, and from 7.6.0 the seeded files of its own that C-15 and C-16 name (`CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md`, `DESIGN-PROFILE.md`, `.claude/toolkit/README.md`), which the toolkit promised never to overwrite, so they go on the same page. List every file and its finding ids in one page before the first edit; apply on approval, per file where the user says so.
3. **Never edit the plugin.** The fix for a convention is always in the project's file, by the fix shape the convention names. If a fix seems to need a change in the toolkit, that is an issue against the toolkit, and the finding lands in the digest as open.
4. **The toolkit's own repository is not a project.** If `.claude-plugin/marketplace.json` at the root names the toolkit itself (a marketplace named `llm-peer-review`, or one that lists a plugin named `tk`), stop. A project that publishes a plugin of its own has a marketplace file too, and this upgrade runs there as in any project.
5. **No em dashes or en dashes** in anything you write.

</rules>

## Procedure

<procedure>

### 1. Audit for candidates

From the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js
```

Findings come out as JSONL on stdout, one per line, in the same shape a review finder returns (`id`, `severity`, `convention`, `file`, `what`, `fix`, `since`, optional `fields`, and a `receipt` with a `check` and an `expect`). The stderr summary states the range and ends with the suppressed count: "N candidate finding(s); K of M convention(s) in range <from> -> <to> [C-1, ...]; P project-owned prompt file(s); S suppressed by the refuted record", where S is how many findings the refuted record of step 7 kept out of this run. The range starts at the version this project was last audited against, which right after a migration is the copy-install's version, so the first upgrade after `/tk:setup` audits everything since.

The range is never empty, because C-7, C-9 to C-12 and C-14 to C-16 are checked on every upgrade, so "current" is decided by candidates, not by the range. Each fires only on a real difference (C-7 when the project's rules file text differs from the shipped seed; C-9 to C-11 when a permission row, a seeded line or a toolkit name is behind; C-12 when a row of the project's own review-kinds file cannot be dispatched; C-14 when an agent or a dispatch line of the project's own breaks the model routing rule; C-15 when a seeded block of a file of the project's own is still an older seed's text, or a file of its own names `${CLAUDE_PLUGIN_ROOT}`; C-16 when the lessons index holds a bullet beyond one sentence while `LESSONS-detail.md` is absent, or a lesson inherited from the toolkit's own log), so a release that changes none of those adds no candidate. Zero candidates with no `manual` convention in range leaves no finding that could survive the audit, which means the project is current: say so in one line, stamp (step 7), commit what the stamp changed, and stop. No issue, no sample cycle.

### 2. Open the cycle's issue

Every cycle has an issue, and this is one, but opening it is an outward send (M9): ask in one line ("Open the upgrade issue for <from> -> <to>? [yes]") and create it only on a yes, with the host's CLI: run the "Create issue" row with the title `Upgrade toolkit <from> -> <to>` in single quotes and a body of five lines or fewer (the conventions in range by id and title, and the candidate count), in a `mktemp -d` file on both hosts (inline on GitLab only through the table's `Unknown flag` fallback), per the quoting rule under the invocation table below (never double quotes or `$(...)`). Keep it short; the findings, not the issue, carry the detail. Detect the host once, here, and reuse the answer:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/host-cli.md"`

### 3. Judge the manual conventions

For each convention in range whose detector is `manual` (C-4 today; C-13 has its own step, 3b), read every file in its scope yourself and judge it against the `Looks behind` prose. Emit a finding for each miss in the same JSON shape, with the file, the line the judgment rests on, and a receipt whose `check` is a read of that file (`sed -n '<start>,<end>p' <file>`) and whose `expect` says what the bytes show. A judgment with no receipt fails tier 1 by definition.

### 3b. Run the prompt audit (C-13)

When C-13 is in range, judge it here rather than by reading files. The other conventions follow what changed in the toolkit; none can say which of this project's own instructions newer models no longer need, and Claude Code ships an audit for that. Invoke the `claude-api` skill through the Skill tool, once, with the arguments `prompt-audit CLAUDE.md, .claude/, LESSONS.md and DESIGN-PROFILE.md (this project's own Claude Code configuration and the files its sessions read, which is C-13's scope; leave out enabled plugins; report only, edit nothing)`.

Turn each finding that names a file and line into a C-13 finding in step 1's shape: `what` is the audit's reason, `fix` is its proposed edit, and the receipt's `check` prints the flagged line (`sed -n '<line>p' <file>`) with the flagged text as its `expect`. Two kinds never become findings:

- **A plugin file.** The toolkit owns it, and the next plugin update replaces it.
- **`.claude/rules/toolkit.md` above its `<!-- Project section:` line.** That part is the toolkit's seed, which C-7 keeps in step with each release, so an edit there comes back as drift. List each one in the digest as open, marked "toolkit text", so the user can report it to the toolkit.

The rest go through step 4's audit and step 6's one batch page like every other finding, so no prompt edit is applied without that approval (M9). They are `manual` findings, so step 6 re-verifies them through the fix-verifier, never by running the audit again. When the call is unavailable, say so in one line and go on to step 4: with no `claude-api` skill in this session, suggest updating Claude Code, which ships the skill, and then running `/claude-api prompt-audit`; when the call fails, suggest `/claude-api prompt-audit` by hand once this run is done. Either way the audit runs once per project, on the upgrade that brings C-13, with no retry.

### 4. Audit (M2)

You are the runner. Write every finding line this run collected, the workers' lines and any the runner authored itself, into `findings.jsonl` in a fresh folder from `mktemp -d /tmp/review-merge.XXXXXX` with the Write tool, then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-findings.js` on that path, typed as literal words: its stdout is the deduplicated, sorted, numbered set (R1 onward, no gaps) and its stderr line carries the raw and merged counts. Two findings that describe one defect under different keys are the one judgment this pass leaves to you: before running the helper, give the later one the earlier one's `key` and record the merge in the report's dedup notes. A finding of the script's keeps its convention id as `sourceId`, which the report's summary line shows beside the number. Then run the three tiers exactly as M2 describes: execute every `receipt.check` yourself and save each output under `reports/receipts/<run-stamp>/` per "Where the report is written" below; dispatch tier 2 shards over the surviving Warns and Suggests and, should any finding be a Block, three tier 3 voters, all as `subagent_type=tk:audit-skeptic`, each carrying only its findings' verbatim bytes and the receipt output; tally the verdicts. The typical kill here is C-1 matching a file the project itself owns: the receipt shows the path exists in the project and the skeptic refutes it. The loop's rules are inlined here so nothing is improvised:

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md"`

**Project fix rules** (from `.claude/toolkit/fix-rules.md`). Additive only: they may add a precondition or an always-ask action, and a line that loosens or removes any of M1 to M15 is void. A note that the command printed nothing means this project adds none.

!`cat .claude/toolkit/fix-rules.md 2>/dev/null || true`

### 5. Report

Write the report per the format below, with `upgrade` as the `<who>` segment of the path and every surviving finding carrying its convention id in the summary line (`**R1** [C-1] ⚠️`). Killed findings go to the Audited out section with their verdict lines. This report is markdown only: the standing review page belongs to the sample cycle in step 8, not to this audit.

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md"`

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md"`

### 6. Fix and re-verify

Page once with the batch (rule 2): every file to be edited, its finding ids, and the fix shape each convention names. Two C-9 findings are not file edits: the `defaultMode` finding is a question for the user, asked in that page and never auto-fixed (change the key only on their answer; C-9, C-10 and C-11 run on every upgrade, but this question comes only on the upgrade whose range crosses 7.1.0, so it is never asked twice), and the fix for missing toolkit rows is to re-run `/tk:setup`, which merges them, not to edit `settings.local.json` by hand. The C-9 lost-rows finding is different: those are the project's own rows, which a 7.0.x migration removed although their script is still there, and Claude cannot add allow rows to `.claude/settings.local.json` (the harness guards that file against an agent widening its own grants), so the fix is the user's: list the rows in the batch page for the user to add to `permissions.allow`, then re-verify by rerunning the audit. C-15 and C-16 findings edit files of the project's own that the toolkit seeded once and promised never to overwrite: each goes on the batch page as a line of its own and is applied only on a tick, like C-13; one left unticked stays open in the digest and comes back on the next upgrade, which is that promise kept. On approval, apply each fix in the project's file, subject to the intent-reversal guard (M7). Re-verify per M3: a finding from any script detector (regex, agent-tools, seed-stamp, dead-permissions, permission-rows, seed-lines, seed-blocks, lessons-shape, unscoped-names, review-kinds, agent-models) is mechanical, so rerun the audit and let the rerun decide: the finding is FIXED when no finding in the rerun carries its `key`. A key names the convention, the file, and what the finding is about (for a line, a digest of that line's text), never a line number, so a finding keeps its key while lines above it change; its receipt checks what the detector checks, so after a correct fix it exits non-zero as well. A `manual` finding goes to `subagent_type=tk:fix-verifier` shards with the original finding, the file:line, and the diff. M5 bounds the rounds at two; M6 sweeps the other project files for the same claim, which the rerun does for free. Before applying the first fix, note the output of `git rev-parse HEAD`: that commit is this upgrade's start, and step 8 reviews everything after it. When the loop is green, checkpoint-commit the fixes (M4), naming each file this run changed in `git add` (never `git add -A` or `git add .`), so no unrelated change in the working tree rides along. Leave `.claude/settings.local.json` out of that commit: git ignores it and the pre-push check blocks it, so rows the C-9 fix restored there stay a local change.

### 7. Stamp

On a clean fix loop, record that this project is audited up to the installed version, before the sample cycle hands off:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js --stamp
```

When the audit killed any finding of the script's (tier 1 `RECEIPT FAILED`, tier 2 `REFUTED`, tier 3 `REFUTED 2/3` or `3/3`), write the keys of those findings, one per line, into `refuted.txt` in a fresh folder from `mktemp -d /tmp/upgrade-stamp.XXXXXX` with the Write tool, and run the stamp with that path typed as literal words instead:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js --stamp --refuted <stamp-dir>/refuted.txt
```

The stamp records those keys in the working copy's refuted record, in the git directory beside the offered-rows record, and the next audit leaves them out and says on its summary line how many it suppressed. Only kills go in that file: never a fix the user declined (those come back on purpose), and never a finding you authored yourself in step 3 or 3b, whose key no later audit could match. Only a finding whose key digests the text it is about is remembered, a line or a seeded block, so a line that changes is reported again; a finding about a whole file (missing rows, the rules text, the lessons index) has a fixed key, so the stamp leaves it out, says so, and the next audit reports it again.

It sets `version` and `auditedVersion` in `.claude/.toolkit-state.json`; the next `/tk:upgrade` starts its range there. When `.claude/rules/toolkit.md` still matches the shipped seed text, it also moves the version in that file's stamp line, so both files may change: commit them now, naming both paths, so the sample cycle's range includes the stamp. It also writes each C-9 lost row this run reported into the working copy's offered-rows record, outside git, so a row the user declined or removes later is never offered again. The stamp never lowers a recorded version: run from an older plugin, it leaves the higher value in place. Clean means: no finding NOT FIXED after two rounds, and no page still waiting on the user. A finding the user chose to leave open on purpose (an upstream-only script edit under C-6, carried in the digest with its receipt and the tagged base link) does not block the stamp: it is a decision, not a failure, and it would otherwise block every migration that carried a local edit. The same holds for a C-7 finding the user declined because they keep their own wording in the rules file: carry it in the digest and stamp anyway, or the upgrade notice would return every session (the finding itself comes back on the next upgrade until the text or its stamp line is updated by hand). A run that paged and stopped leaves the state file alone, so the next run sees the same range. An upgrade also changes what the codebase map describes, while M12 counts commits only, so end this step by refreshing the map: run `/tk:index` when the project has one, and do nothing when it has none (the next `/tk:explore` builds it).

### 8. One sample cycle

Announce it ("Upgrade fixes are in; running one `/tk:review <start>..HEAD` over them so the loop is proven on <to> before this cycle closes.") and invoke `/tk:review` through the Skill tool with the argument `<start>..HEAD`, where `<start>` is the commit noted in step 6: the range holds exactly the fixes and the stamp this run committed. It runs the typed finders, the audit, and the auto-fix loop on the new version, and chains into `/tk:document` itself (M14), which records the cycle with this run's issue. Do not invoke `/tk:document` separately. The sample cycle's own fixes are committed by its loop (M4), as in any review. A change under fifty lines with no code file takes the orchestrator's inline path, so the sample cycle proves the audit and the loop rather than a finder dispatch; that is fine, the dispatch shape is proven by the next code change.

</procedure>

## The migration case

<reference>

When `/tk:setup` migrated a copy-install, `.claude/.toolkit-migration.json` lists every toolkit script that carried a local edit, with the backup path of the user's copy. C-6 turns each into a finding whose receipt is the evidence of the edit: the migration record's line for the file, the hash the backed-up copy-install manifest recorded for it, and the different hash of the backup copy. The finding also names the toolkit file at the tag of the version the backup came from (`.../blob/v<version>/<path>`); that tagged file is the base of the user's edit. Never diff the backup against the current plugin copy, and never file such a diff: the plugin copy also carries every toolkit change since that copy-install, so the diff would show those as the user's edit and filing it would revert them. The fix is never to edit the plugin: the user either describes the edit upstream in an issue (from a diff against the tagged file), or moves it into a script the project owns under a different name and points their own command at it. A finding the user chooses to upstream stays open in the digest with the issue link, which is the receipt that it was not dropped. A modified entry that is not a toolkit piece, such as `.gitattributes`, is the project's own file: nothing goes upstream, and the lines the migration dropped come back through the C-10 lost-lines finding.

The repair checks (C-9 to C-11) run on every upgrade, as the rules stamp check (C-7) does, so a project audited at an older version still gets every later fix to them. Permission rows are checked in both directions (toolkit rows and force-push ask rows the seed now writes that are missing, and retired rows still present, removed in one finding; the broad `npm install *` row is not retired, so a project that adds packages keeps it), a row written with `:*` counting as the same row written with ` *`, and a row this working copy was offered before is never offered again; `defaultMode` is raised as a question rather than a fix, and only on the upgrade whose range crosses 7.1.0. Seeded lines that went stale are flagged, among them a line naming a toolkit file the project does not have, together with the comment lines above it. A file that still names a toolkit command, skill, or agent without its `tk:` prefix becomes a finding: the project's prompt files and the instruction files Claude Code loads (`CLAUDE.md` at the root or in the `.claude` folder, and `CLAUDE.local.md`) as Should fix, and `DESIGN-PROFILE.md` as Optional; `LESSONS.md`, and any line that starts with a date or a version, records history and is left alone.

</reference>

## HTML Output Rules

This audit's own report is markdown only, and the sample cycle in step 8 runs `/tk:review`, which carries its own page rules. The shared rules are inlined for the temporary-folder steps this run takes (the issue body in step 2):

!`cat "${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md"`
