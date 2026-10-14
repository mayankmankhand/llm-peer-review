---
name: error-analysis
description: Group the correction ledger's open codes into categories, count them, and rank what you actually keep correcting, then fix one where it lives and measure whether it shrank. The second half of the two-stage coding started by /document's capture stage. Read-only against the ledger; never publishes and never sends anything off the machine.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Error Analysis

**Use this when:** Enough corrections have accumulated that you want to know which ones are a pattern rather than a one-off and where each one should be fixed, or you want to fix one and later see whether it shrank.

**Don't use this when:** You want to record a correction (that happens automatically at `/document`), or you want to review code (use `/review`).

## What this is

`/document` captures **open codes**: free-text notes, in your words, describing what went wrong each time you stepped in. This command does the **axial coding**: reading those open codes across the whole corpus, grouping them into categories, and ranking the categories by how often they occur.

The split exists because a category invented at n=1 is a guess. You cannot see a pattern in the first instance of it, so naming patterns is deliberately deferred until there are instances to look at.

## Rules

<rules>

1. **Never publish, and never send anything off this machine.** No HTML artifact, no hosted-page publish, never fed to `/ask-gpt`, `/ask-gemini`, or any other external model. This is a flat rule with no consent path and no "ask the user first" exception. The ledger is a private per-machine record of things the user said, and a consent prompt would be an invitation to leak it. If a future session finds a reason this rule should not apply, the reason is wrong. The no-ask publish rule in `.claude/skills/shared/html-viewing.md` does not apply here: this skill renders nothing.
2. **The ranking prints only the shareable layer.** Open codes, counts, repo names, dates, and the homes and rates the helper computes. Never `produced`, `correction`, `trigger` or `rewrite`: read the rollup, which the helper builds from a whitelist that cannot reach them. Each bucket carries an `open_codes` array of `{open_code, count}`, so everything the coding below needs is in the rollup. The one exception is the fix loop's evidence step, which reads one repo's private fields from inside that repo only; they stay in that step and never enter a committed file, a commit message, a PR body, `LESSONS.md`, an artifact, or an outside model.
3. **Rank within a kind, never across kinds.** Pooling human-labeled rows with machine-labeled ones makes a count meaningless, so each kind gets its own ranking; while every row is `human`, that is one ranking.
4. **Never invent a count.** Every number you show, rates and cycle counts included, comes from the helper. If you find yourself estimating, stop and run the helper.
5. **User-triggered only.** This command is never chained into (M14). Running it is a deliberate choice.

</rules>

## Procedure

### 1. Read the current state

```bash
node .claude/scripts/correction-ledger.js --show-rollup
```

This prints the rollup without writing it. It carries `rows`, `ever_captured`, `repos_captured`, and, when there is nothing to rank, a `status` block.

### 2. Handle an empty ledger honestly

When `rows` is 0, the `status.reason` field says which kind of empty it is, and the two call for opposite responses:

- **`never-captured`** - capture has never run on this machine. Say so, and give the reasons `status.message` names: the document stage (`/document`) has not run here since capture shipped, or cycles were closed through an older document command that has no capture stage (a customized `document.md` kept from a copy-install, or a global `~/.claude/commands/document.md` run by its bare name instead of the toolkit's command). Do not present this as "you have made no mistakes."
- **`nothing-found`** - capture has run and genuinely found nothing to record. Say that plainly.

Stop after this. There is nothing to code.

### 3. Say when there is too little to rank

A ranking built on one or two instances per bucket is noise wearing a chart's clothes. Before presenting anything, read the shape from the rollup, never by eye (M16): `node .claude/scripts/correction-ledger.js --show-rollup` prints the rollup JSON; read `rows` (under 10 is too few to rank) and, under `kinds`, every bucket whose `count` is exactly 1, the `kind/bucket` names to treat as noise rather than rank:

- Fewer than **10 rows total**: report the individual open codes as a list, with counts, and say explicitly that this is too few to rank. Do not sort them into categories yet.
- Any bucket at **count 1**: show it, but never describe it as a pattern.

Naming a "top problem" from thin data is the exact mistake this whole mechanism exists to prevent. Do not commit it in the act of reporting.

### 4. Do the axial coding

Read the open codes from each bucket's `open_codes` array in the rollup (everything not yet categorized lands in the `(unlabeled)` bucket, which on a first run is all of them). The counts beside each open code tell you which wordings already recur before you group anything.

Group them by **what went wrong**, not by which file or feature was involved. Two corrections about different files are the same category when the underlying gap is the same; two corrections about the same file are different categories when they are not.

Write your assignments as `axial-map.json` in a fresh folder from `mktemp -d /tmp/axial-map.XXXXXX`, made and used per "Temporary folders" in `.claude/skills/shared/html-outputs.md`, as a flat object of open code to category name, then hand that file to the helper:

```json
{
  "assumed a prompt instruction would be obeyed without checking enforcement": "trusted prose as a control",
  "gitignored the file without checking the stronger protections around it": "shipped the weakest protection first"
}
```

```bash
node .claude/scripts/correction-ledger.js --set-axial --data <folder>/axial-map.json
```

`<folder>` is the path `mktemp` printed. The script deletes the file after merging, and the fresh folder keeps two sessions from merging or losing each other's assignments.

**Write only the assignments you are making now. Do not restate the existing ones.** The helper merges into the stored map and reports how many existed, how many arrived, and the new total. Two reasons it goes through the helper rather than a direct file write: merging in code means a run that covers only the newest open codes cannot silently drop every earlier assignment, and the stored map lives outside the project where a direct write would be refused on a default install.

The ledger itself is append-only and is never rewritten. The map is joined to it at rollup time, so re-categorizing later is a new assignment rather than an edit to history. Keep existing assignments stable unless a category is genuinely wrong: a category that changes name every run cannot be counted over time.

### 5. Recompute and present

```bash
node .claude/scripts/correction-ledger.js --rollup
```

Present the ranked buckets in chat:

- Biggest bucket first, with its count, its `spread` (how many repos it appears in) and its `home`, the place a fix belongs: `project` when it appears in one repo; `toolkit` when it appears in two or more and more than half its rows came during a toolkit stage (explore, create-plan, execute, review or document); `global` when it appears in two or more otherwise, meaning the user's global instructions file. A bucket with one row, and `(unlabeled)`, have no home: they are not patterns yet.
- Show the capture-time `scope_split` beside the home as a hint only, and say so when `hint_disagrees` is true. The home comes from the spread, because a tag chosen at capture time sees one row and the spread sees them all.
- Name the single bucket you would act on, and say why it is that one rather than the next.
- Flag anything still in `(unlabeled)`.
- Show each group's share by month: its `by_month` count over its kind's `months` total for the same month, both read from the rollup, never estimated. Put first the groups a check written before the work would catch (M17); this toolkit's own coding names four: "plan missed a case or a stakeholder", "claimed done without proof", "never tried it as the reader would", "fixed one spot and left the rest". A month with only a few rows is noise, the same as a small bucket.
- When the rollup carries `fixes`, list each with its rate before and after and the cycle counts behind them. Call a change real only when `enough_cycles` is true (at least 5 cycles on each side); otherwise say it is too early to read.
- Remind the user that a toolkit note filed from an earlier ranking still needs `--record-fix --home toolkit --version <x.y.z>` once the release that ships it is out; until then its category has no before and after.

Keep it short. The point of the ranking is to make one decision obvious, not to produce a report.

## The fix loop

Acting on a bucket is a separate, deliberate choice, made one bucket at a time, and every fix waits for the user's approval.

1. **Pick the bucket and read its home** from the rollup: `project`, `global` or `toolkit`.
2. **Read the evidence where the rows live.** In a session opened in the repo the rows came from (for a bucket spread across repos, one of them), run:

   ```bash
   node .claude/scripts/correction-ledger.js --evidence --category '<category name>'
   ```

   It prints that repo's rows for the category with their private fields (what was asked, what was produced, the correction, and the user's own rewrite when there is one) and nothing from any other repo. It matches each row's main working copy against this folder's by real path, refuses outside a git repository, and prints nothing in an opted-out repo. Run it only from a session opened in that repo, never by stepping into another repo's folder from elsewhere: the script can check the folder, not which session is asking.
3. **Draft the fix for its home.**
   - `project`: that repo's own `CLAUDE.md`, or a rules file it already uses. It may describe this project's own case in its own words, but never quotes a row's private fields: that file is committed.
   - `global`: the user's global instructions file, `~/.claude/CLAUDE.md`. Every project's sessions read it, so write it in generic words: no quotes, no project names.
   - `toolkit`: a toolkit prompt or rule. It leaves the repo only as a generic note (the pattern, with no quotes and no project names) that the user approves before it is filed as an issue in the toolkit's repository.
4. **The user approves the drafted text before it lands.** These files are the user's.
5. **Record the fix** once it has landed:

   ```bash
   node .claude/scripts/correction-ledger.js --record-fix --category '<category name>' --home <project|global|toolkit> --label '<what changed, in a few generic words>'
   ```

   A project fix is recorded from inside its repo. A toolkit fix is recorded once the release that ships it is out, with `--version <x.y.z>` naming that release; filing its note is not landing it. The helper stamps the exact time and stores the category's rate so far as the fix's `before`.
6. **Read the result on later rankings.** The rollup's `fixes` show each fix's rate before and after: rows per `/document` cycle, where a cycle is the stretch between two heartbeats of one working copy. Before counts the cycles that ended by the fix's time; after counts the cycles that began after it; the cycle in progress when it landed counts in neither. A project fix is measured in its own repo, a global or toolkit fix across every repo, and a toolkit fix only over cycles that recorded a version: an older release before the fix, the fixed one or later after it.

What the measurement cannot see: each working copy's first cycle and rows marked `backfill:` are left out, because their scan window differs (`rates_left_out` counts them); running `/document` twice in one stretch adds a cycle; a cycle closed through an older document command writes no heartbeat, so it is invisible; and a heartbeat with no recorded version never counts toward a toolkit fix.

## One-time backfill of past transcripts (optional, by request only)

Capture is forward-only by design: the first run in a repo scans only the newest session, and every later run scans from that repo's last heartbeat. The `--since <ISO timestamp>` flag on `--candidates` overrides that window and is the one supported way to look backwards. It exists for a single, deliberate, one-time pass and is never the default.

Rules for a backfill:

- **Only when the user asks, and only for the repo they name.** Never sweep every project on the machine. Other projects' transcripts are private conversations; the per-repo opt-out marker (`.claude/.no-correction-log`) is honored at scan time exactly as it is for forward capture.
- **Same gate as forward capture.** Candidates go through the same `correction-extractor` read and the same human-written open code; nothing is recorded that the user did not confirm. Expect the open codes to be rougher than live ones, because the context has faded.
- **Say what it is worth before running it.** Run `--candidates --since <date>` first and report the candidate count per day. A backfill is worth it only when that count would move the first rankable ranking forward by weeks; if it is small, say so and let the user decide.
- **Mark the rows.** Start each open code from a backfill pass with `backfill:` so a later ranking can separate the two populations.

```bash
# one-time backfill, run from the repo being backfilled; prints candidates, writes nothing
node .claude/scripts/correction-ledger.js --candidates --since 2026-08-01T00:00:00Z
```

`--candidates` never writes: it only reads transcripts and the heartbeat file. The ledger is written by `--add`, the heartbeat by `--heartbeat`, and `--rollup` and `--set-axial` write their own files under `~/.claude/`. A candidate count is free to look at and safe to discard.

### Filling in the request and rewrite on older rows

Rows recorded before the request and rewrite fields existed can have them filled in from transcripts still on disk (Claude Code deletes transcripts after a retention period, 30 days by default). This never adds a row: a duplicated row cannot be told apart from a real recurrence, so the filled-in fields go to a private side file, `~/.claude/correction-backfill.jsonl`, keyed by each row's `at` and `session`, and the evidence step joins them back on. Same rules as a backfill of rows: only when the user asks, only for the repo they name, from a session opened in that repo.

1. List what can be filled in. This writes nothing:

   ```bash
   node .claude/scripts/correction-ledger.js --backfill-candidates
   ```

   It prints this repo's rows that lack the two fields and still have a transcript, each with the exchange around it, plus counts of the rows it could not use (no session recorded, transcript gone, no message at that exact time).
2. Dispatch the `correction-extractor` agent with that output, exactly as capture does. It returns the filled-in fields in its `backfill` array.
3. Show each one to the user. Nothing is written until they accept it, and they can drop either field.
4. Write the accepted entries as `correction-backfill-rows.json` in a fresh folder from `mktemp -d /tmp/correction-backfill.XXXXXX`, made and used per "Temporary folders" in `.claude/skills/shared/html-outputs.md`, then run:

   ```bash
   node .claude/scripts/correction-ledger.js --add-backfill --data <folder>/correction-backfill-rows.json
   ```

   The helper checks the whole batch before writing anything: every entry must match a row of this repo that has not been filled in yet. It deletes the file after a successful write.

## What this command does not do

- **It does not fix anything on its own.** The fix loop is a separate, deliberate choice, and every fix waits for the user's approval.
- **The month view shows when, not why.** A group's share falling in the months after a change is the signal to look for, not proof the change caused it: the mix of work, the projects captured and how closely you were watching all move a share too. Name the change and the months on either side, and call it a share that moved, never a fix that worked.
- **It does not see what you never corrected.** Anything Claude got wrong that you accepted is invisible to this data, and those are concentrated in whatever you scrutinize least. Say so when presenting, if a ranking is about to be treated as the complete picture.
