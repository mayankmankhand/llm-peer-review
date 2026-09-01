---
name: error-analysis
description: Group the correction ledger's open codes into categories, count them, and rank what you actually keep correcting. The second half of the two-stage coding started by /document's capture stage. Read-only against the ledger; never publishes and never sends anything off the machine.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Error Analysis

**Use this when:** Enough corrections have accumulated that you want to know which ones are a pattern rather than a one-off, and which of them are about the toolkit versus this project.

**Don't use this when:** You want to record a correction (that happens automatically at `/document`), or you want to review code (use `/review`).

## What this is

`/document` captures **open codes**: free-text notes, in your words, describing what went wrong each time you stepped in. This command does the **axial coding**: reading those open codes across the whole corpus, grouping them into categories, and ranking the categories by how often they occur.

The split exists because a category invented at n=1 is a guess. You cannot see a pattern in the first instance of it, so naming patterns is deliberately deferred until there are instances to look at.

## CRITICAL RULES

<rules>

1. **Never publish, and never send anything off this machine.** No HTML artifact, no hosted-page publish, never fed to `/ask-gpt`, `/ask-gemini`, or any other external model. This is a flat rule with no consent path and no "ask the user first" exception. The ledger is a private per-machine record of things the user said, and a consent prompt would be an invitation to leak it. If a future session finds a reason this rule should not apply, the reason is wrong. The no-ask publish rule in `.claude/rules/html-outputs.md` does not apply here: this skill renders nothing.
2. **Print only the shareable layer.** Open codes, counts, scope splits, repo names, dates. Never the `produced` or `correction` fields. The rollup helper already projects those out, so read the rollup rather than the raw ledger. The rollup carries the open codes themselves: each bucket has an `open_codes` array of `{open_code, count}`, so everything you need for the coding below is in the rollup and nothing is in the private layer.
3. **Rank within a kind, never across kinds.** Only `human` rows exist today, so this is one ranking. The rule is written now because a second kind added later would carry machine-written labels, and pooling human-labeled with machine-labeled rows makes a count meaningless.
4. **Never invent a count.** Every number you show comes from the rollup helper. If you find yourself estimating, stop and run the helper.
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

- **`never-captured`** - capture has never run on this machine. Say so, and give the three reasons it happens: `/document` has not run since this shipped, a global `~/.claude/commands/document.md` is shadowing the project copy, or a customized `document.md` was kept instead of taking the update. Do not present this as "you have made no mistakes."
- **`nothing-found`** - capture has run and genuinely found nothing to record. Say that plainly.

Stop after this. There is nothing to code.

### 3. Say when there is too little to rank

A ranking built on one or two instances per bucket is noise wearing a chart's clothes. Before presenting anything, check the shape:

- Fewer than **10 rows total**: report the individual open codes as a list, with counts, and say explicitly that this is too few to rank. Do not sort them into categories yet.
- Any bucket at **count 1**: show it, but never describe it as a pattern.

Naming a "top problem" from thin data is the exact mistake this whole mechanism exists to prevent. Do not commit it in the act of reporting.

### 4. Do the axial coding

Read the open codes from each bucket's `open_codes` array in the rollup (everything not yet categorized lands in the `(unlabeled)` bucket, which on a first run is all of them). The counts beside each open code tell you which wordings already recur before you group anything.

Group them by **what went wrong**, not by which file or feature was involved. Two corrections about different files are the same category when the underlying gap is the same; two corrections about the same file are different categories when they are not.

Write your assignments to a temp file as a flat object of open code to category name, then hand it to the helper:

```json
{
  "assumed a prompt instruction would be obeyed without checking enforcement": "trusted prose as a control",
  "gitignored the file without checking the stronger protections around it": "shipped the weakest protection first"
}
```

```bash
node .claude/scripts/correction-ledger.js --set-axial --data /tmp/axial-map-<run>.json
```

Use a name unique to this run (a timestamp is enough): the script deletes the file after merging, and two sessions sharing one name would merge or lose each other's assignments.

**Write only the assignments you are making now. Do not restate the existing ones.** The helper merges into the stored map and reports how many existed, how many arrived, and the new total. Two reasons it goes through the helper rather than a direct file write: merging in code means a run that covers only the newest open codes cannot silently drop every earlier assignment, and the stored map lives outside the project where a direct write would be refused on a default install.

The ledger itself is append-only and is never rewritten. The map is joined to it at rollup time, so re-categorizing later is a new assignment rather than an edit to history. Keep existing assignments stable unless a category is genuinely wrong: a category that changes name every run cannot be counted over time.

### 5. Recompute and present

```bash
node .claude/scripts/correction-ledger.js --rollup
```

Present the ranked buckets in chat:

- Biggest bucket first, with its count and its `scope_split`.
- Split toolkit-scope from project-scope visibly. Toolkit-scope patterns generalize to every install and are the ones worth fixing in a prompt or rule; project-scope ones are about this codebase.
- Name the single bucket you would act on, and say why it is that one rather than the next.
- Flag anything still in `(unlabeled)`.

Keep it short. The point of the ranking is to make one decision obvious, not to produce a report.

## One-time backfill of past transcripts (optional, by request only)

Capture is forward-only by design: the first run in a repo scans only the newest session, and every later run scans from that repo's last heartbeat. The `--since <ISO timestamp>` flag on `--candidates` overrides that window and is the one supported way to look backwards. It exists for a single, deliberate, one-time pass and is never the default.

Rules for a backfill, decided 2026-08-31:

- **Only when the user asks, and only for the repo they name.** Never sweep every project on the machine. Other projects' transcripts are private conversations; the per-repo opt-out marker (`.claude/.no-correction-log`) is honored at scan time exactly as it is for forward capture.
- **Same gate as forward capture.** Candidates go through the same `correction-extractor` read and the same human-written open code; nothing is recorded that the user did not confirm. Expect the open codes to be rougher than live ones, because the context has faded.
- **Say what it is worth before running it.** Run `--candidates --since <date>` first and report the candidate count per day. A backfill is worth it only when that count would move the first rankable ranking forward by weeks; if it is small, say so and let the user decide.
- **Mark the rows.** Start each open code from a backfill pass with `backfill:` so a later ranking can separate the two populations.

```bash
# one-time backfill, run from the repo being backfilled; prints candidates, writes nothing
node .claude/scripts/correction-ledger.js --candidates --since 2026-08-01T00:00:00Z
```

`--candidates` never writes: it only reads transcripts and the heartbeat file. The ledger is written by `--add`, the heartbeat by `--heartbeat`, and `--rollup` and `--set-axial` write their own files under `~/.claude/`. A candidate count is free to look at and safe to discard.

## What this command does not do

- **It does not fix anything.** It is advisory. Acting on a pattern is a separate, deliberate choice.
- **It does not measure whether a past fix worked.** Rates over time are a later phase; nothing here tracks whether a category shrank after you changed something.
- **It does not see what you never corrected.** Anything Claude got wrong that you accepted is invisible to this data, and those are concentrated in whatever you scrutinize least. Say so when presenting, if a ranking is about to be treated as the complete picture.
