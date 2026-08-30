# Codebase Map Generator (Index)

**Use this when:** You want to (re)generate `CODEBASE_MAP.md` - a semantic map of the project that `/explore`, `/create-plan`, and `/pair-debug` read for context.
**Don't use this when:** You're doing a full documentation pass - use `/document` instead, which regenerates the map as part of broader doc updates.

<rules>
- This is a procedural command. Follow the steps in order.
- Subagent prompts must direct **conditional detection**: only report conventions and gotchas when there is concrete code evidence. No speculation.
- The final map MUST stay under ~10k tokens. If synthesis exceeds, trim sections in the order listed in Step 5 - the Module Guide is the semantic core and is trimmed last.
- Use **atomic write** (Step 5 details). Never delete the legacy `INDEX.md` until the new map is fully written and validated. A failed run must leave the user's existing state intact.
- If any step fails (scanner error, all subagents fail after Step 3's one automatic retry per chunk, validation fails), stop and report. Do NOT partially overwrite `CODEBASE_MAP.md`.
</rules>

## Steps

<procedure>

### Step 1: Scan the codebase
Run the deterministic scanner and capture its JSON output:

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
> "Your project has ~{totalTokens} tokens across {totalFiles} files. Generating the codebase map will spawn {chunks.length} parallel subagents (Sonnet via the index-mapper agent). Estimated one-time cost: a few dollars. Proceed?"

**If `anyChunkOverflows === true` (a chunk is oversized despite chunking):**
> "Your largest chunk is ~{largestChunkTokens} tokens, which exceeds the per-chunk target of {chunkTargetTokens}. This usually means one or more files slipped past the size filter. The oversized subagent may truncate or fail. You can proceed (risky), or stop and add the offending files to the skip list. Proceed?"

If `needsConfirm === false`, skip this step silently.

### Step 3: Spawn parallel analysis subagents
For each chunk in `manifest.chunks`, spawn an Agent with `subagent_type=index-mapper` - the pinned mapper agent, whose model and effort (Sonnet at low effort) come from `.claude/agents/index-mapper.md` per the routing rule in `.claude/skills/shared/model-routing.md`. The frontmatter pin is what makes the Step 2 cost message ("Sonnet via the index-mapper agent") true rather than aspirational - without it the chunks silently inherit the session model. Pinning subagents is safe and carries no prompt-cache penalty: they build their context from scratch. Do NOT pin Step 4 (synthesis) - that runs on the main loop and must stay on the session model ("pin down, inherit up" per the routing rule). Fallback per that rule: if the `index-mapper` agent type is unavailable (older install), use `subagent_type=general-purpose` carrying the model its roster row declares, `model=sonnet`. Use this prompt template, substituting the chunk's file list:

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
- Keep each block under ~200 tokens. Your full response should be under ~2000 tokens.
- Do not output anything besides the module blocks - no preamble, no summary, no commentary.

</template>

Launch all subagents in parallel (one Agent tool call per chunk in a single message). Wait for all to return.

If any subagent fails or returns an empty response, retry that chunk once automatically (same prompt, same model pin) - do not interrupt the user for a first failure. Exception: do not auto-retry an oversized chunk (one whose `totalTokens` exceeds `manifest.chunkTargetTokens`) - a retry fails the same way, so ask the user directly. If the retry also fails or comes back malformed, re-spawn that chunk once one tier up (`subagent_type=general-purpose`, no model parameter, so it inherits the session model) per the routing rule's guardrail; if that also fails, ask the user whether to retry again or continue with partial coverage, and note the gap for Step 7. If EVERY chunk failed, do not offer partial coverage - follow the "All subagents fail" edge case instead: report the failure and leave the existing map untouched.

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

### Step 5: Apply size cap and write atomically

**Trim policy** (if synthesized content exceeds ~10k tokens, apply in this exact order). The Module Guide is the semantic core - the whole point of the v4.4.0 redesign was that a flat tree without semantic content does not save tokens. Trim everything else first.

1. **Collapse the Directory Tree** to depth 2-3 (drop deeper nesting, keep top-level structure)
2. **Drop the Gotchas section**
3. **Drop the Conventions section**
4. **Drop the Navigation Guide**
5. **As a last resort:** trim Module Guide entries to one-line Purpose summaries (still preferable to dropping the section entirely)

Record any trimming in the map header (e.g., add `<!-- Trimmed: tree-to-depth-3, gotchas -->` so consumers know what's missing).

**Atomic write** (this is critical for not corrupting user state on partial failure):

1. Write the content to `CODEBASE_MAP.md.tmp` in the project root.
2. Validate the temp file:
   - It exists and is non-empty (> 200 bytes)
   - The first line is the `<!-- Generated: -->` header comment
   - It contains a `# Codebase Map` heading
   - It contains a `## Module Guide` section
3. If validation passes: rename `CODEBASE_MAP.md.tmp` to `CODEBASE_MAP.md` (this is the atomic step - `mv` is atomic on POSIX filesystems).
4. If validation fails: delete the temp file and stop with an error. Do NOT touch the existing `CODEBASE_MAP.md` or `INDEX.md`.

### Step 6: One-time INDEX.md migration (only after successful write)
**Only run this step after Step 5 succeeded.** If `INDEX.md` exists in the project root, delete it. It's been replaced by `CODEBASE_MAP.md`. (This handles the upgrade case for projects that had the old flat-tree index.)

If Step 5 failed, skip this step entirely - the user's old `INDEX.md` is still useful as a fallback.

### Step 7: Report to the user
Tell the user:
- "Generated `CODEBASE_MAP.md` ({totalFiles} files mapped, ~{mapTokens} tokens)."
- If trim policy fired, list which sections were trimmed/dropped.
- If `isDirty` was true: "Note: map generated against a dirty worktree. Consider regenerating after your next commit for an accurate commit reference."
- If old `INDEX.md` was removed, mention it: "Removed legacy `INDEX.md`."
- If any subagent failed and was skipped, mention the gap.

</procedure>

## Edge cases

<conditions>

- **Empty repo (0 tracked files):** The scanner emits an empty file list. Skip Steps 2-3. In Step 4, write a minimal `CODEBASE_MAP.md` with just the header and a note: "No tracked files yet. Commit some files and run `/index` to regenerate."
- **Single tiny project:** Manifest has 1 chunk. Spawn 1 subagent. The flow works identically.
- **Scanner script missing:** Tell the user the toolkit is incomplete and to re-run `setup.sh`.
- **Not a git repo:** Scanner errors out. Tell the user to `git init` first.
- **All subagents fail:** Do NOT write a partial/empty map. Report the failure and leave any existing `CODEBASE_MAP.md` and `INDEX.md` untouched.
- **Per-chunk overflow detected:** Step 2's confirm prompt covers this. If the user proceeds anyway, the oversized subagent may truncate or fail - report the gap in Step 7.

</conditions>
