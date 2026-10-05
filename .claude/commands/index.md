# Codebase Map Generator (Index)

**Use this when:** You want to (re)generate `CODEBASE_MAP.md` - a semantic map of the project that `/explore`, `/create-plan`, and `/pair-debug` read for context.
**Don't use this when:** You're doing a full documentation pass - use `/document` instead, which refreshes the map when it is missing or stale (M12) as part of broader doc updates.

<rules>
- This is a procedural command. Follow the steps in order.
- Subagent prompts must direct **conditional detection**: only report conventions and gotchas when there is concrete code evidence. No speculation.
- The final map stays under about 10k tokens. `--finalize` enforces that cap itself (Step 5): it trims the other sections in a fixed order and never cuts the Module Guide, the semantic core, which only you shorten, and only when the script says the map is still over.
- Use **atomic write** (Step 5 details): a failed run must leave the user's existing map intact.
- If any step fails (scanner error, all subagents fail after Step 3's one automatic retry per chunk, validation fails), stop and report. Do NOT partially overwrite `CODEBASE_MAP.md`.
</rules>

## Steps

<procedure>

### Step 1: Scan the codebase
First resolve the model mode: run `node .claude/scripts/session-init.js --models`, adding `--mode <m>` when the arguments carry a `mode:<m>` word, and say "Models: <models.mode>" as your first line. `models.perRole["index-mapper"]` is the mapper's model for Steps 2 and 3; call it `{mapperModel}`, reading `session` as your own model.

Then run the deterministic scanner and capture its JSON output:

```
node .claude/scripts/generate-index.js
```

Parse the JSON. The manifest contains:
- `totalFiles`, `totalTokens`, `skippedFiles`, `skipCounts` (binary/lockfile/secret/minified/oversized/missing breakdown)
- `commit` (current HEAD hash, for staleness tracking)
- `isDirty` and `dirtyFileCount` (uncommitted changes present?)
- `timestamp` (UTC, for the map header)
- `chunks` (array of `{ id, files: [{path, tokens}], totalTokens }`)
- `largestChunkTokens` (size of the largest chunk - helps explain overflow)
- `chunkTargetTokens` (the per-chunk token target - a chunk whose `totalTokens` exceeds this is oversized)
- `directoryTree` (array of indented strings)
- `needsConfirm` (true if project total > 500k tokens OR any chunk overflows the per-chunk target)
- `anyChunkOverflows` (true if at least one chunk exceeds the per-chunk target despite chunking)

If the JSON has an `error` field, show the message to the user and stop.

### Step 2: Cost confirmation (only if needed)
If `manifest.needsConfirm === true`, prompt before spending API tokens. The exact message depends on why confirmation is needed:

**If `totalTokens > 500_000` (project is large):**
> "Your project has ~{totalTokens} tokens across {totalFiles} files. Generating the codebase map will spawn {chunks.length} parallel subagents ({mapperModel} via the index-mapper agent). Estimated one-time cost: a few dollars. Proceed?"

**If `anyChunkOverflows === true` (a chunk is oversized despite chunking):**
> "Your largest chunk is ~{largestChunkTokens} tokens, which exceeds the per-chunk target of {chunkTargetTokens}. This usually means one or more files slipped past the size filter. The oversized subagent may truncate or fail. You can proceed (risky), or stop and add the offending files to the skip list. Proceed?"

If `needsConfirm === false`, skip this step silently.

### Step 3: Spawn parallel analysis subagents
For each chunk in `manifest.chunks`, spawn an Agent with `subagent_type=index-mapper` with `model` set to its `models.perRole` value, where `session`, or a model above your own, means your own model family's alias. It is the mapper agent, whose effort comes from its agent frontmatter, per the roster in `.claude/skills/shared/model-routing.md` (which also says why). Step 4 (synthesis) runs in the main session, on the session model. Fallback per that rule: if the `index-mapper` agent type is not found, run `/reload-plugins` once (an agent added by a plugin install or update, or written this session, registers only after a reload), then use `subagent_type=general-purpose` carrying the same `model`. Use this prompt template, substituting the chunk's file list:

<template>

You are analyzing part of a codebase. Read each file in this list and produce a structured analysis. Read-only - do not modify anything.

**Files in your chunk:**
{for each file: `- {file.path}`}

**For each file (or coherent module of related files), output a markdown block in this exact format:**

```
## {file path or module name}
**Purpose:** {See "Purpose handling" below.}
**Entry points:** {Functions, exports, slash commands, or CLI commands a caller would invoke. Omit if there are no clear entry points.}
**Key dependencies:** {What this file imports or depends on - other modules, packages, external services. Omit if none.}
**Observed conventions:** {Only include if you can point to specific code as evidence - consistent naming, repeated structural pattern, etc. Omit if no clear signal.}
**Gotchas:** {Only include if you see explicit WARNING comments, defensive code around a specific bug, or non-obvious behavior. Omit if nothing concrete.}
```

**Purpose handling - read carefully:**
- If the file's role is clear from the code, write 1-2 sentences on what it does.
- If you cannot determine the purpose from the code, write exactly `purpose unclear` and move on. Do NOT guess, infer from the filename, or speculate. `purpose unclear` is the correct answer when evidence is missing.

**Rules:**
- Be evidence-based. If you cannot point to specific code or comments as evidence for a convention or gotcha, do NOT include it.
- Group tightly related small files (e.g., a 5-file utility folder) into one module block. Single large files get their own block.
- Keep each block under ~200 tokens and the whole response under ~2000: every chunk's blocks are merged into one map that must stay under ~10k tokens.
- Do not output anything besides the module blocks - no preamble, no summary, no commentary.

</template>

Launch all subagents in parallel (one Agent tool call per chunk in a single message). Wait for all to return.

If any subagent fails or returns an empty response, re-dispatch that chunk once, one tier up (`subagent_type=general-purpose` with `model` set to your own model family's alias: a call with no model parameter follows `CLAUDE_CODE_SUBAGENT_MODEL` when a user has set it, measured on Claude Code 2.1.289, and could land the retry on the model that just failed) per guardrail 2 in `.claude/skills/shared/model-routing.md`, which bounds a retry at one extra spawn - do not interrupt the user for a first failure. Exception: do not auto-retry an oversized chunk (one whose `totalTokens` exceeds `manifest.chunkTargetTokens`) - a retry fails the same way, so ask the user directly. If that one re-dispatch also fails or comes back malformed, ask the user whether to retry again or continue with partial coverage, and note the gap for Step 6. If EVERY chunk failed, do not offer partial coverage - follow the "All subagents fail" edge case instead: report the failure and leave the existing map untouched.

### Step 4: Synthesize the map content
Combine the subagent responses into a single map content string (do NOT write the file yet - Step 5 handles the write atomically). Use this structure:

<template>

```
<!-- Generated: {manifest.timestamp} -->
<!-- Commit: {manifest.commit}{if isDirty: " (generated_while_dirty: " + dirtyFileCount + " files)"} -->
<!-- Files: {manifest.totalFiles}, Skipped: {manifest.skippedFiles}, Tokens: {manifest.totalTokens} -->

# Codebase Map

> Semantic map generated by `/index`, refreshed by `/document`.
> If HEAD has moved since the commit above, this map may be stale - run `/index` to refresh.
{if isDirty: "> WARNING: this map was generated against a dirty worktree (" + dirtyFileCount + " uncommitted changes). Treat it as approximate until a fresh commit + regenerate."}

## System Overview
{1-paragraph summary synthesized from the module purposes. What is this project, what does it do, what's its shape?}

## Directory Tree
{manifest.directoryTree rendered as a markdown list}

## Module Guide
{All subagent module blocks, sorted alphabetically by path. Keep Purpose, Entry points, and Key dependencies. Drop conventions/gotchas from this section - they get their own.}

## Conventions
{Collected "Observed conventions" from subagent responses. Group similar ones. Drop this section entirely if no conventions were reported.}

## Gotchas
{Collected "Gotchas" from subagent responses. Drop this section entirely if none were reported.}

## Navigation Guide
{3-6 short bullets synthesized from the module guide. Examples:
- "To add a new slash command: edit .claude/commands/<name>.md"
- "To change auth behavior: src/auth/ is the entry point"
Skip this section if the project has no obvious extension points.}
```

</template>

### Step 5: Write atomically and let the script apply the size cap

1. Write the full synthesized content to `CODEBASE_MAP.md.tmp` in the project root with the file-writing tool. Trim nothing yourself: the script measures the map and applies the size cap below.
2. From the project root, finish the write with one call:

   ```bash
   node .claude/scripts/generate-index.js --finalize
   ```

   It validates the temp file (over 200 bytes, a `<!-- Generated:` first line, a `# Codebase Map` heading, and a `## Module Guide` section unless the header says `Files: 0`), applies the size cap, renames the result over `CODEBASE_MAP.md` (the atomic step), removes a legacy `INDEX.md`, and prints one JSON object.

   **The size cap.** A map over about 10k tokens is trimmed in this order, each step only while the map is still over: the Directory Tree to depth 3, then to depth 2, then the Gotchas section, then Conventions, then the Navigation Guide. The Module Guide is the semantic core and the script never cuts it. The script records what it cut in a `<!-- Trimmed: ... -->` header line and in the JSON's `trimmed` array; a step that cut nothing is left out of both.
3. On `{"finalized":true, ...}` (exit 0): keep `tokens` for Step 6's size, `trimmed` for its trimmed-sections line, and `indexRemoved` for its legacy-file line. When `overCap` is true, the map is in place but still over the cap after every step: shorten each Module Guide entry to a one-line Purpose (still better than dropping the section), write the temp file again, and run `--finalize` once more; report the second result. Once is the limit.
4. On `{"finalized":false, "error": ..., "reason": ...}` (exit 1): the script has already deleted the temp file and left the existing `CODEBASE_MAP.md` and `INDEX.md` untouched. Stop and tell the user the `reason`.

### Step 6: Report to the user
Tell the user:
- "Generated `CODEBASE_MAP.md` ({totalFiles} files mapped, ~{mapTokens} tokens)."
- If `trimmed` is not empty, list its entries as the sections trimmed or dropped, and say so when `overCap` stayed true after the second run.
- If `isDirty` was true: "Note: map generated against a dirty worktree. Consider regenerating after your next commit for an accurate commit reference."
- If old `INDEX.md` was removed, mention it: "Removed legacy `INDEX.md`."
- If any subagent failed and was skipped, mention the gap.

</procedure>

## Edge cases

<conditions>

- **Empty repo (0 tracked files):** The scanner emits an empty file list. Skip Steps 2-3. In Step 4, write a minimal map: the full Step 4 header (its `<!-- Files: 0, ... -->` line is how `--finalize` recognizes a minimal map), the `# Codebase Map` heading, the two `>` lines under it, and a note: "No tracked files yet. Commit some files and run `/index` to regenerate." Then write it through Step 5 as usual; a shorter minimal map falls under the 200-byte floor and is refused.
- **Single tiny project:** Manifest has 1 chunk. Spawn 1 subagent. The flow works identically.
- **Scanner script missing:** Tell the user the toolkit install is incomplete. On the plugin, reinstall or update it (`claude plugin marketplace update llm-peer-review`, then `claude plugin update tk@llm-peer-review`, then restart Claude Code); on a copy-install, run `/setup` to move the project onto the plugin, or re-run the copy-install's own setup script (`setup.sh` or `setup.ps1`).
- **Not a git repo:** Scanner errors out. Tell the user to `git init` first.
- **All subagents fail:** Do NOT write a partial/empty map. Report the failure and leave any existing `CODEBASE_MAP.md` and `INDEX.md` untouched.
- **Per-chunk overflow detected:** Step 2's confirm prompt covers this. If the user proceeds anyway, the oversized subagent may truncate or fail - report the gap in Step 6.

</conditions>
