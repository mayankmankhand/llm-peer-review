# Toolkit Conventions

<!-- Parsed by scripts/upgrade-audit.js, the deterministic half of /tk:upgrade. Keep each entry in exactly the format under "Entry format": the parser reads the heading and the bold-labelled bullets and nothing else. Ids are permanent: never renumber, never reuse. -->

A convention is a countable unit with one source (issue #167). Each entry carries an id that never changes, the release it arrived in, what it applies to, how a file behind it is found, and the shape of the fix. `/tk:upgrade` reads this file, selects the entries whose `Since` lies in the range (last audited version, current plugin version], plus every entry marked `Runs: every upgrade`, runs each detector over the files the project owns (its own commands, skills, agents, and rules under `.claude/`, plus `CLAUDE.md`, and for C-11 the other files its sessions read; the plugin's files are never in the project), and turns every hit into a finding with a stable key and a runnable receipt. From there the normal loop applies: the M2 audit judges the findings, survivors are auto-fixed, every fix is re-verified by rerunning the audit (a finding is fixed when no finding in the rerun carries its key), and the run ends by stamping `.claude/.toolkit-state.json` so the next upgrade starts where this one stopped. The CHANGELOG's Upgrading section names, by id, the conventions each release adds.

A convention describes the toolkit's contract with a project's own files. It is not a style guide for the project's code, and it never fires on a file the toolkit ships.

## Entry format

```
### C-<n>: <title>
- **Since:** <version the convention arrived in>
- **Runs:** every upgrade   (optional; only on an entry that must be checked on every upgrade)
- **Scope:** prompt-files | prompt-files+claude-md | prompt-files+session-files | claude-md | agents | settings-local | seed-stamp | seed-lines | local-edits
- **Detector:** regex | seed-stamp | dead-permissions | permission-rows | seed-lines | unscoped-names | local-edits | agent-tools | manual
- **Looks behind:** `<a JavaScript regular expression, applied per line; repeat the bullet for several>`
- **Fix:** <the shape of the fix, one line>
```

`regex` needs one or more `Looks behind` patterns; the other detectors carry their check in the script and take none. `manual` is the one detector the script does not run: the `/tk:upgrade` skill reads the files in scope itself, judges each against the `Looks behind` prose, and emits findings in the same shape with a file-read receipt. Use it only for a judgment no grep expresses.

`Runs: every upgrade` takes an entry out of the version range: it is checked on every upgrade, whatever version the project was last audited at. Use it only for a check whose subject can fall behind on any release, such as the seeded rules text, which any release can change; an entry without the bullet runs only when its `Since` lies in the range.

A hit is a candidate, not a verdict. Every finding goes through the M2 audit before anything is fixed, and the audit is where a false positive dies: a path pattern that matched a file the project itself owns, a dispatch name that only looks like a toolkit agent. The receipt on each finding is the grep that found it, so a skeptic can refute it from the bytes.

## Conventions

### C-1: Refer to toolkit pieces by name, never by path
- **Since:** 7.0.0
- **Scope:** prompt-files+claude-md
- **Detector:** regex
- **Looks behind:** `\.claude/skills/shared/`
- **Looks behind:** `\.claude/scripts/(ask-gpt|ask-gemini|browse|generate-index|open-artifact|render-html|session-init|pre-push-check|correction-ledger|gen-media|setup-project|upgrade-audit)\.(js|sh)`
- **Looks behind:** `\.claude/agents/(review-finder|review-[a-z]+-finder|audit-skeptic|fix-verifier|plan-critic|design-critic|index-mapper|correction-extractor)\.md`
- **Looks behind:** `\.claude/(commands/(explore|create-plan|execute|review|document|create-issue|ask-gpt|ask-gemini|peer-review|pair-debug|package-review|codebase-to-course|worktree|index)\.md|skills/(review-[a-z-]+|project-context|dispatch-contract|design-rules|security-audit|audit-html|playground|error-analysis|learning-opportunity|setup|upgrade)/)`
- **Fix:** name the piece: a skill is `Skill(tk:<name>)`, an agent is `subagent_type=tk:<name>`, a shared fragment is inlined from the stable path `~/.claude/plugins/data/tk-llm-peer-review/current/skills/shared/<file>`, a script runs as `node ~/.claude/plugins/data/tk-llm-peer-review/current/scripts/<file>`

Why: the plugin's files live in a versioned cache folder, not in the project, so a `.claude/...` path that used to reach a copy-installed file now reaches nothing. The plugin's SessionStart hook keeps `~/.claude/plugins/data/tk-llm-peer-review/current` pointing at the installed version, which is the one path a project may write down. A project's own skill whose folder name starts with `review-` matches the last pattern and is refuted at audit time; the receipt shows the path exists in the project.

### C-2: A dispatch names a typed agent
- **Since:** 7.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** `subagent_type\s*[=:]\s*["'`]?(tk:)?review-finder\b`
- **Looks behind:** `subagent_type\s*[=:]\s*["'`]?general-purpose\b.*(review|criteria|findings|skeptic|verif)`
- **Fix:** dispatch `subagent_type=tk:review-<kind>-finder` (code, ux, copy, security, plan, deps, commands, browser), `tk:audit-skeptic`, `tk:fix-verifier`, or `tk:plan-critic`; `review-finder` is deprecated in 7.0 and removed in 8.0

Why: the per-kind finders preload their criteria and the dispatch contract, so a dispatch carries only the run's context; a `general-purpose` worker doing review work carries every tool, Edit included, and can change files before the M2 audit ever judges its findings.

### C-3: Criteria reach a worker by preload, not by paste
- **Since:** 7.0.0
- **Scope:** prompt-files
- **Detector:** regex
- **Looks behind:** `PASTE THE (SKILL'S )?REVIEW CRITERIA`
- **Looks behind:** `PASTE THE SPECIALIST'S EXPERT ROLE`
- **Looks behind:** `cat [^ ]*review-[a-z]+/SKILL\.md`
- **Fix:** give the worker a `skills:` line in its agent frontmatter that names the criteria skill (a toolkit one, `tk:review-<kind>-criteria`, or the project's own), and paste nothing

Why: a pasted manual sits in the parent transcript once per dispatch and is the first thing compaction truncates; a preloaded skill loads inside the worker, byte for byte, every time. An inline-cat of a review skill no longer yields its criteria either: since 7.0.0 the skill's own inline-cats do not expand inside another file.

### C-4: Every agent declares an output contract
- **Since:** 7.0.0
- **Scope:** agents
- **Detector:** manual
- **Looks behind:** `an agent body that never says what it returns: no fixed shape (JSONL lines, "one line per ID", "Score: N/10"), no literal for the empty case, nothing a dispatcher could parse or count`
- **Fix:** end the agent with the exact return shape and the literal for "nothing found", so malformed output is visible and a re-dispatch is bounded

Why: the routing guardrails depend on it. A worker with a checkable return can be re-dispatched once on malformed output and its findings can be audited; one that returns free prose fails silently.

### C-5: Finders and judges carry no edit tools
- **Since:** 7.0.0
- **Scope:** agents
- **Detector:** agent-tools
- **Fix:** declare `tools: Read, Grep, Glob` (Bash only for read-only checks the job needs); a finder or judge never edits

Why: a finder that could edit would apply changes before the M2 audit judged them, and a judge that could edit would be a fixer, which M3 forbids. The detector reads every project-owned agent whose name or description says finder, reviewer, critic, skeptic, verifier, judge, or auditor, and flags one with no `tools:` line (every tool, by default) or with Edit, Write, or NotebookEdit in it.

### C-6: Toolkit scripts are upstream-only
- **Since:** 7.0.0
- **Scope:** local-edits
- **Detector:** local-edits
- **Fix:** diff your backup copy against the same file at the toolkit tag it came from (`https://github.com/mayankmankhand/llm-peer-review/blob/v<previousVersion>/<path>`), never against the current plugin copy; carry what that diff shows as a project-owned script the toolkit does not ship, or describe it in an issue upstream

Why: the plugin's scripts are replaced whole on every update, so an edit to a copy is lost the next time. The migration from a copy-install records each locally modified script in `.claude/.toolkit-migration.json` with its backup path; this convention turns each record into a finding whose receipt is the evidence of the edit (the migration record, the hash the copy-install's manifest recorded for the file, and the different hash of the backup copy), so the edit is either upstreamed or moved, never silently dropped. The current plugin copy is not the base of the edit: it also carries every toolkit change made since that copy-install, so a diff against it shows those changes as if they were the user's, and filing that diff upstream would revert them.

### C-7: Seeded files carry the current stamp
- **Since:** 7.0.0
- **Runs:** every upgrade
- **Scope:** seed-stamp
- **Detector:** seed-stamp
- **Fix:** merge the shipped seed's rules text into the file by hand and update its stamp, or delete the seeded rules file and run `/tk:setup`, which writes a fresh one only when it is missing; a file whose text already matches the seed needs no fix, because the audit's `--stamp` at the end of a clean run raises its stamp

Why: `.claude/rules/toolkit.md` is the one toolkit-shaped file a project owns, and the project's sessions read it every turn. The detector compares the file's text with the rules seed the installed plugin ships, leaving the stamp line out of both (CRLF line endings and trailing blanks do not count), and fires only when the file's stamp is older than the plugin and the text differs: the seeded rules text changed since the project's copy was written, or the project edited its copy. A file whose text matches the seed is current whatever its stamp says, so an older stamp alone is no finding, and the seed file's own stamp plays no part. The audit's `--stamp` rewrites only the version in such a file's stamp line, never lowers a stamp, and never raises the stamp of a file whose text differs. A file with no usable stamp is still reported, and a project with no rules file is not. The seed's text can change on any release, so this entry runs on every upgrade rather than only when its `Since` is in range: a project audited at 7.0.0 or later would otherwise never be told its rules text is stale.

### C-8: Permissions point at the plugin, not at removed scripts
- **Since:** 7.0.0
- **Scope:** settings-local
- **Detector:** dead-permissions
- **Fix:** remove the entries; each plugin command carries `allowed-tools` for the scripts it runs

Why: a `Bash(node .claude/scripts/...)` row allows a path nothing runs any more. Dead allow rows are not dangerous, but they hide the row that matters and they age into a settings file nobody understands.

### C-9: Permission rows match the shipped seed
- **Since:** 7.1.0
- **Runs:** every upgrade
- **Scope:** settings-local
- **Detector:** permission-rows
- **Fix:** re-run `/tk:setup` to merge the toolkit rows the file lacks; remove the rows the shipped retired list names; ask the user about `"defaultMode": "acceptEdits"`, never change it without their answer; put back in `permissions.allow` each row the migration record lists as removed although the project script it runs still exists

Why: a project migrated on 7.0.0 or 7.0.1 received that release's whole seed in `.claude/settings.local.json`, including grants only the toolkit's own repository needs and bare `Skill(<name>)` rows that never match a `tk:` skill, and it does not receive a row a later seed adds. Any release can add, narrow or retire a seed row, so this entry runs on every upgrade. The detector reads the plugin's shipped `seed/settings.local.json` and `seed/retired-permission-rows.txt` and reports three kinds of finding: toolkit rows the file lacks, retired rows it still has, and the `acceptEdits` default mode. Rows compare the way Claude Code matches them: a Bash or PowerShell rule ending in `:*` is the same rule as the one ending in ` *`, so `Bash(git status:*)` in the file is not reported missing, and a retired `Bash(xdg-open *)` is found when it is written `Bash(xdg-open:*)`. A toolkit row counts as present in any permissions list (allow, ask, or deny). A row the working copy's offered-rows record lists is never reported missing again: the record sits in the git directory (`git rev-parse --git-path tk-offered-rows.json`, so git never commits it), `/tk:setup` writes every seed row it offers there, and a listed row the file lacks is one the owner removed. The record filters only a file that exists, because a missing `settings.local.json` holds no decision. A retired `Skill(<name>)` row naming a command, skill or agent the project owns itself is the project's own grant and is never reported. The default mode is its own finding and a question, worded for where the key sits, and it is asked only when the upgrade's range crosses 7.1.0, the release that added it, so an answer is never asked for twice: the 7.0.x seed wrote it at the top level, where Claude Code does not document it (`defaultMode` belongs under `permissions`), so it is a leftover that may have no effect, to delete or to move under `permissions` if the user wants edits auto-accepted; under `permissions` it auto-accepts every file edit, which a user may have chosen. It also reports rows a migration removed although the project script they run still exists: 7.0.0 treated every `.claude/scripts/` row as dead, so a project's own script lost its grant. Only the migration record's `deadPermissions` list says which rows a migration removed (7.0.0 and 7.0.1 wrote one). A record that keeps only a count, as 7.1.0 and later write, gives no such finding, and neither does a record with neither field. The backup copy of `settings.local.json` is no source, because it also holds every row the migration kept, including one the owner deleted later. A listed row is reported only when no permissions list holds it in either spelling, it names a file under the project's own `.claude/scripts/` that exists now (an absolute path only when it resolves inside the project, a folder name with a space included), the retired list does not name it, and the offered-rows record does not list it. The stamp at the end of a clean `/tk:upgrade` writes each such row into the offered-rows record, so a row the owner removes afterwards, or declined in that run, is never offered again in that working copy.

### C-10: Seeded root files carry no copy-install lines
- **Since:** 7.1.0
- **Runs:** every upgrade
- **Scope:** seed-lines
- **Detector:** seed-lines
- **Fix:** replace the line with the shipped seed's line, or delete it when the seed has none in its place, in `.gitignore` together with the comment lines directly above it; a line that ignores the state file is never deleted: keep it and add `!.claude/.toolkit-state.json` after it, or, when it ignores the whole `.claude` folder, ask the user how to narrow it; a line of the project's own that a 7.0.x migration dropped from a file it replaced is appended back to that file; a committed migration record stops being tracked with `git rm --cached .claude/.toolkit-migration.json`, which keeps the file on disk

Why: `.gitattributes`, `.gitignore`, and `artifacts/README.md` are written once and then belong to the project, so lines an older seed wrote stay after the layout they describe is gone. Toolkit paths and seed text change with releases, so this entry runs on every upgrade. The detector flags a line in any of the three files that names a toolkit `.claude/` path the project does not have: a path the plugin's `managed-paths.json` lists or the migration record's `removed` names, such as `.claude/scripts/pre-push-check.js` in an old `.gitignore` comment or `.claude/rules/html-outputs.md` in an old `artifacts/README.md`. A path like `~/.claude/plugins/.../scripts/render-html.js` belongs to the plugin, not the project, and never counts. Lines are matched by what they name, never by comparing whole files with old toolkit copies: old `.gitignore` copies also carried lines such as `/build`, `/.next/`, and `*.pem`, and deleting those would un-ignore build output and keys. A stale `.gitignore` line takes the comment lines directly above it into its finding, so a fix never strands half a comment, and a stale comment block is replaced by the seed's comment lines above the same rule. The detector also flags `.gitattributes` lines naming `.claude/scripts/` once the project keeps no files there (a migration keeps a project's own scripts in that folder, and the rule keeps their line endings right), the `.gitignore` copy-install manifest block (`.claude/.toolkit-manifest.json` and the "preserved by setup.sh" comment), any `.gitignore` line that ignores `.claude/.toolkit-state.json` (the state file is committed so every collaborator's session sees the recorded version), and `artifacts/README.md` lines naming `.claude/scripts/render-html.js`. The state file check reads the whole `.gitignore` the way git does, so a later `!.claude/.toolkit-state.json` clears it, while a negation under an ignored folder does not. Such a line is often the project's own broad pattern (`.claude/`, `*.json`), so deleting it would un-ignore everything else it covers: the fix keeps it and re-includes only the state file. It also reports a line of the project's own that a 7.0.x migration dropped from a file it replaced, still present in the backup: 7.0.0 removed and reseeded `.gitattributes`, so a rule such as a Git LFS line survives only in the backup folder. A backup line counts as the project's own when it is not blank or a comment and none of the live file, the shipped seed, or any earlier toolkit release's copy of the file has it (lines compare with blanks collapsed). It also reports `.claude/.toolkit-migration.json` when git still tracks it: a 7.0.x migration wrote that record and projects committed it, its 7.0.0 and 7.0.1 format lists the removed permission rows (some with this machine's absolute paths), and the seed's ignore line never untracks a file git already has. Whether a `.gitignore` of the project already ignores the record is git's answer from the project's `.gitignore` files alone, so this machine's own excludes file, even one that ignores the whole `.claude` folder, never hides the project's line.

### C-11: Toolkit names carry the tk: scope
- **Since:** 7.1.0
- **Runs:** every upgrade
- **Scope:** prompt-files+session-files
- **Detector:** unscoped-names
- **Fix:** scope the name with `tk:`: `Skill(tk:<name>)`, `subagent_type=tk:<name>`, `/tk:<name>`; in `.claude/settings.local.json`, scope the row or drop it when the `tk:` row is already there

Why: under the plugin every toolkit command, skill, and agent is registered as `tk:<name>`, so a bare name reaches nothing, or reaches a project piece of the same name. A release can add a name, so this entry runs on every upgrade. The detector reads the names from the plugin's own `commands/`, `skills/`, and `agents/` and flags `Skill(<name>)`, `subagent_type=<name>` or `subagent_type: <name>`, and a `/<name>` mention in the project's own prompt files and in the files its sessions read (the `prompt-files+session-files` scope): `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md`, which Claude Code loads as instructions, at Should fix; `LESSONS.md`, which the loop commands read at session start, and `DESIGN-PROFILE.md`, which `/tk:explore` reads before design work, at Optional. `LESSONS-detail.md` is opened only on demand and stays out. It also flags bare `Skill(<name>)` rows in `.claude/settings.local.json`. A name the project owns itself is never flagged. URLs are blanked before matching, and a slash mention needs a boundary on both sides, so file paths (`docs/review.md`), relative link paths, closing tags such as `</document>`, and prose such as "a UX/review of the design" stay out. A slash right after a markdown link target `](`, a reference definition, an attribute value (`href="/review"`), a CSS `url(`, an HTTP method (`GET /index`) or a shell command that takes a path (`cd /worktree`) is a root-relative path, not a mention. A bare row the retired list already names is left to C-9, whose fix removes it.

## How a release adds a convention

1. Append an entry with the next id; ids are never renumbered or reused, so a downstream project can cite one across releases.
2. Give a `regex` detector a pattern that `scripts/test-upgrade-audit.js` exercises against a downstream-shaped fixture, both a hit and a clean file. A new detector kind is a script change with its own test.
3. Name the id in the CHANGELOG's Upgrading section for that release, with one line on what the fix looks like.
4. A convention that stops applying is not deleted: its `Since` stays, and a note under it says which release retired it, so an old install upgrading across several versions still sees the history.
