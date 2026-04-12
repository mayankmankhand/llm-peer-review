# Lessons Learned

<!-- Keep entries concise. For deep dives into why a concept works, use /learning-opportunity instead. -->

## What I Learned
<!-- Add entries after each session where you learned something new -->

- **XML tags in prompts are a real thing, not just hype.** All three major providers (Anthropic, OpenAI, Google) recommend XML for complex, multi-section prompts. The key insight: XML helps AI distinguish *what kind of content* a section is (rules vs templates vs examples), which markdown headers alone can't do.
- **Hybrid approach beats all-or-nothing.** Don't replace markdown with XML - use both. Markdown headers stay for human readability, XML wraps content blocks for AI parsing. Pattern: header outside the tag, content inside.
- **AI peer review recommendations often over-engineer.** When /ask-gpt and /ask-gemini reviewed the XML plan, they recommended namespaced tags (`tk_rules`), a formal schema file, testing rubrics, and a three-wave rollout. Most of that was unnecessary for 9 small files. Trust your gut when something feels like too much.
- **A worktree is just a folder, a branch is just a pointer.** They're independent. Deleting a worktree folder does not delete the branch, PR, or any commits. You can always re-create a worktree from the same branch. Think of it like closing a document window vs. deleting the file.
- **Worktree detection: `--git-dir` vs `--git-common-dir`.** To check if you're in a Git worktree, compare `git rev-parse --git-dir` with `git rev-parse --git-common-dir`. If they differ, you're in a worktree. The first attempt used `--show-toplevel` vs `--git-common-dir`, which compares a directory path to a `.git` path - they're never equal, so it always said "worktree." The review process caught this before it shipped.

- **Use deterministic scripts for structural data, not LLMs.** When generating a file tree index, the first instinct was to have Claude scan and describe every file. Both GPT and Gemini called this out: "using an LLM to generate a token-saving index burns more tokens than it saves." A 20-line Node script using `git ls-files` does the job in milliseconds with zero token cost. Reserve LLMs for judgment calls, not mechanical tasks.
- **Version bumps touch more files than you think.** When releasing v3.4, the reviews caught 5 files that needed version updates: VERSION, CHANGELOG.md, AGENT-SETUP.md title + "What's new" section, and README references. Easy to miss one. No automated fix for the toolkit repo (the checklist would leak to downstream users), so just remember to check all five manually.
- **`settings.json` can get modified by research subagents.** During the index format research, a subagent fetching aider.chat added a WebFetch permission and additionalDirectories to `.claude/settings.json`. Always run `git diff` before committing to catch unintended changes from subagent side effects.

## Mistakes to Avoid
<!-- Add patterns that caused problems so they don't repeat -->

- **Don't micro-tag individual bullets.** Tag sections, not lines. Wrapping every bullet in XML adds noise without helping parsing.
- **Watch for tool output artifacts in reviews.** The Read tool's output wrapper (`</output>`) can look like actual file content. Always verify with raw bytes before "fixing" something that might not be broken.
- **Review your own AI-generated code before shipping.** The initial worktree detection logic had a fundamental bug that would have broken every worktree feature. Running `/review-commands` and `/review-code` caught it. The review workflow exists for a reason - don't skip it even when the code "looks right."
- **Skill tool expansions can serve stale command versions.** Root cause: old command files in `~/.claude/commands/` (global/home directory) override the project's `.claude/commands/` files. In our case, 9 files were manually copied to the home directory in January before setup.sh existed, then never updated. When slash commands ran, the AI used the global copies instead of the current project versions - missing Staff Engineer Check, Finding IDs, and other updates. Fix: delete global copies (commands should only live in each project folder) and setup.sh now warns if it detects conflicting global files. See issue #52.

- **AI debates surface things standard reviews miss.** Running `/ask-gpt` and `/ask-gemini` alongside the 5 `/review-*` commands found insights none of the reviews caught: tone/task decoupling (shift questions but keep tone after scope narrowing) and the need for a vision-mode closing deliverable template. The debates push harder on behavioral edge cases because two models are actively challenging each other.
- **"Same command, two gears" vs "new command" decision pattern.** When debating whether to add a mode or create a separate command, the key question is: do they share enough structure? If the two behaviors use the same phases, question format, and guardrails (just different content), one command with modes. If they need different structure or workflow, separate commands. Applied this to `/explore` vision mode - both gears share Phase 1/Phase 2 structure, just different questions and tone.

### Skills migration decisions (issue #71)

- **Subagents do NOT auto-discover project skills.** The orchestrator must read skill files and pass content explicitly. You cannot assume a subagent will "just find" a skill in `.claude/skills/`.
- **Cross-directory file references in skills use `` !`cat ...` `` dynamic injection syntax, not `!include`.** This is how shared content gets pulled into skill prompts at runtime.
- **`@axe-core/playwright` is compatible with `playwright-core`** (peer dependency). No conflict with the library-only Playwright install the toolkit uses.
- **`user-invocable: false` works as documented.** It hides the skill from the slash command menu, but Claude can still invoke it programmatically. Useful for agent-only skills like `project-context`.
- **Shared files reduce duplication across review skills.** `.claude/skills/shared/` eliminated roughly 48 lines of duplicated content across 6 review skills.
- **GPT and Gemini peer review caught things standard reviews missed.** Zombie process risk, setup script legacy cleanup gap, missing documentation files, and an axe-core compatibility question all came from the debate rounds, not from `/review-*` commands.

## Patterns That Work
<!-- Add approaches and conventions that proved effective -->

- **Tag vocabulary for prompts:** `<rules>` (must-follow), `<procedure>` (step-by-step), `<template>` (copy-paste schemas), `<output_format>` (expected output), `<conditions>` (if-then logic), `<guidelines>` (best practices), `<reference>` (lookup tables), `<phase>` (named stages), `<examples>` (good/bad demos).
- **Audit before converting.** Not every file needs XML. Short files, human-facing docs, and already-structured data are fine without it. Focus on files where the AI needs to distinguish content types.
