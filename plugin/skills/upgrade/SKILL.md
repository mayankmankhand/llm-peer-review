---
name: upgrade
description: After /plugin update (or right after a /tk:setup migration), audit this project's own commands, skills, agents, rules, and CLAUDE.md against the toolkit conventions that changed between the last audited version and the installed one, through the normal M2 audit and auto-fix loop. Opens the cycle's issue, fixes what drifted, runs one sample cycle, stamps the state file, and chains into /tk:document.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Agent
  - Skill
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh *)"
  - "Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh)"
  - "Bash(gh issue create *)"
  - "Bash(glab issue create *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/pre-push-check.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js *)"
  - "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js)"
---

# Upgrade

**Use this when:** The toolkit plugin moved to a new version and this project has files of its own under `.claude/` (commands, skills, agents, rules) or a `CLAUDE.md` that mention toolkit pieces; or `/tk:setup` just migrated a copy-install and handed off here.
**Don't use this when:** The project is not on the plugin yet (`/tk:setup` first), or you are inside the toolkit's own repository.

Every convention this run checks is written down once, with its id, the version it arrived in, the signal that finds a file behind it, and the shape of the fix:

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/conventions.md`

## Critical Rules

<rules>

1. **The script finds, the loop judges.** Candidates come from `node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js` plus your own pass over the `manual` conventions. You are M2's runner: every candidate is audited before anything is fixed, and a hit that turns out to be the project's own file dies there with its receipt.
2. **Prompt-file edits page once, as a batch (M9).** The files this run edits are the project's own commands, skills, agents, and rules, which are always-ask. List every file and its finding ids in one page before the first edit; apply on approval, per file where the user says so.
3. **Never edit the plugin.** The fix for a convention is always in the project's file, by the fix shape the convention names. If a fix seems to need a change in the toolkit, that is an issue against the toolkit, and the finding lands in the digest as open.
4. **The toolkit's own repository is not a project.** If `.claude-plugin/marketplace.json` exists at the root, stop.
5. **No em dashes or en dashes** in anything you write.

</rules>

## Procedure

<procedure>

### 1. Audit for candidates

From the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js
```

Findings come out as JSONL on stdout, one per line, in the same shape a review finder returns (`id`, `severity`, `convention`, `file`, `what`, `fix`, `since`, optional `fields`, and a `receipt` with a `check` and an `expect`). The stderr summary states the range: "N candidate finding(s); K of M convention(s) in range <from> -> <to> [C-1, ...]". The range starts at the version this project was last audited against, which right after a migration is the copy-install's version, so the first upgrade after `/tk:setup` audits everything since.

An empty range with zero candidates and no `manual` convention in range means the project is current: say so in one line, stamp (step 7), and stop. No issue, no sample cycle.

### 2. Open the cycle's issue

Every cycle has an issue, and this is one. Announce it in one line ("Opening the upgrade issue for <from> -> <to>; say \"no issue\" to skip."), then create it with the host's CLI, title `Upgrade toolkit <from> -> <to>`, body of five lines or fewer: the conventions in range by id and title, and the candidate count. Keep it short; the findings, not the issue, carry the detail. Detect the host once, here, and reuse the answer:

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/host-cli.md`

### 3. Judge the manual conventions

For each convention in range whose detector is `manual` (C-4 today), read every file in its scope yourself and judge it against the `Looks behind` prose. Emit a finding for each miss in the same JSON shape, with the file, the line the judgment rests on, and a receipt whose `check` is a read of that file (`sed -n '<start>,<end>p' <file>`) and whose `expect` says what the bytes show. A judgment with no receipt fails tier 1 by definition.

### 4. Audit (M2)

You are the runner. Assign ids (`R1`, `R2`, ...) across the script's findings and yours, sorted by severity, then run the three tiers exactly as M2 describes: execute every `receipt.check` yourself and save each output under `reports/receipts/<run-stamp>/` per "Where the report is written" below; dispatch tier 2 shards over the surviving Warns and Suggests and, should any finding be a Block, three tier 3 voters, all as `subagent_type=tk:audit-skeptic`, each carrying only its findings' verbatim bytes and the receipt output; tally the verdicts. The typical kill here is C-1 matching a file the project itself owns: the receipt shows the path exists in the project and the skeptic refutes it. The loop's rules are inlined here so nothing is improvised:

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`

### 5. Report

Write the report per the format below, with `upgrade` as the `<who>` segment of the path and every surviving finding carrying its convention id in the summary line (`**R1** [C-1] ⚠️`). Killed findings go to the Audited out section with their verdict lines. This report is markdown only: the standing review page belongs to the sample cycle in step 8, not to this audit.

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/report-format.md`

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/finding-contract.md`

### 6. Fix and re-verify

Page once with the batch (rule 2): every file to be edited, its finding ids, and the fix shape each convention names. On approval, apply each fix in the project's file, subject to the intent-reversal guard (M7). Re-verify per M3: a regex or agent-tools finding is mechanical, so rerun the audit and the finding is FIXED when its file no longer appears for that id (the receipt is the same grep, now empty); a `manual` finding goes to `subagent_type=tk:fix-verifier` shards with the original finding, the file:line, and the diff. M5 bounds the rounds at two; M6 sweeps the other project files for the same claim, which the rerun does for free. Do not commit yet: `/tk:review` finds what to review from uncommitted changes, so a checkpoint commit here leaves the sample cycle in step 8 nothing to look at. The commit comes at the end of step 8.

### 7. Stamp

On a clean fix loop, record that this project is audited up to the installed version, before the sample cycle hands off:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade-audit.js --stamp
```

It sets `version` and `auditedVersion` in `.claude/.toolkit-state.json`; the next `/tk:upgrade` starts its range there. Clean means: no finding NOT FIXED after two rounds, and no page still waiting on the user. A finding the user chose to leave open on purpose (an upstream-only script edit under C-6, carried in the digest with its diff) does not block the stamp: it is a decision, not a failure, and it would otherwise block every migration that carried a local edit. A run that paged and stopped leaves the state file alone, so the next run sees the same range.

### 8. One sample cycle

Announce it ("Upgrade fixes are in; running one `/tk:review` over them so the loop is proven on <to> before this cycle closes.") and invoke `/tk:review` through the Skill tool over the files this run changed. It runs the typed finders, the audit, and the auto-fix loop on the new version, and chains into `/tk:document` itself (M14), which records the cycle with this run's issue. Do not invoke `/tk:document` separately. When the sample cycle has run, checkpoint-commit whatever of this run's fixes and the stamped state file is still uncommitted (M4). A change under fifty lines with no code file takes the orchestrator's inline path, so the sample cycle proves the audit and the loop rather than a finder dispatch; that is fine, the dispatch shape is proven by the next code change.

</procedure>

## The migration case

<reference>

When `/tk:setup` migrated a copy-install, `.claude/.toolkit-migration.json` lists every toolkit script that carried a local edit, with the backup path of the user's copy. C-6 turns each into a finding whose receipt is the diff between the backup and the plugin's copy. The fix is never to edit the plugin: the user either files the change upstream (the finding's digest line says so, with the diff), or moves it into a script the project owns under a different name and points their own command at it. A finding the user chooses to upstream stays open in the digest with the issue link, which is the receipt that it was not dropped.

</reference>

## HTML Output Rules

The sample cycle in step 8 renders the standing review page; this audit's own report is markdown only. The rules are inlined so the publish and record steps that cycle runs are in context:

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`
