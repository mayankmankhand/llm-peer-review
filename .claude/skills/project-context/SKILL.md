---
name: project-context
description: Provides project context (tech stack, conventions, key rules) to subagents. Not a user command - loaded by the orchestrator when dispatching review subagents.
user-invocable: false
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Project Context

Gather lightweight project context so subagents can make informed decisions. This skill is not user-invocable - it runs automatically when the orchestrator dispatches review subagents.

## What to Detect

<procedure>

1. **Project type** - Check for these markers in order:
   - `package.json` - Node.js / JavaScript / TypeScript
   - `requirements.txt` or `pyproject.toml` - Python
   - `go.mod` - Go
   - `Cargo.toml` - Rust
   - `Gemfile` - Ruby
   - If multiple markers exist, note that (e.g., a Node.js project with Python scripts)

2. **Project rules** - Read these files if they exist:
   - `CLAUDE.md` in the project root
   - `.claude/rules/*.md` for toolkit-level rules
   - Look for critical rules that subagents must follow (e.g., "report only", "no auto-fix")

3. **Tech stack** - From the project marker files, identify:
   - Frameworks (React, Express, Django, etc.)
   - Databases or data stores
   - Key dependencies that shape how code is written
   - Build tools and test runners

4. **Conventions** - Scan a few representative files to identify:
   - Naming patterns (camelCase, snake_case, kebab-case)
   - File structure conventions (e.g., commands in `.claude/commands/`, skills in `.claude/skills/`)
   - Any patterns called out in CLAUDE.md or rules files

5. **Output a compact summary** - Keep it to 10-15 lines max. Include:
   - Project type and main language
   - Key frameworks and dependencies
   - Critical rules that affect how subagents should behave
   - File structure conventions worth knowing

</procedure>

<rules>

- Keep it lightweight - just enough context for informed decisions
- Do not audit the full codebase - sample a few files
- Do not generate reports or findings - this is context gathering, not review
- If a marker file does not exist, skip it and move on

</rules>
