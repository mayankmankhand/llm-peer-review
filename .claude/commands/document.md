# Update Documentation Task

You are updating documentation after code changes.

## Primary Documentation Files

- **CLAUDE.md** - AI assistant instructions (portable across projects)
- **README.md** - Project overview for humans

Keep these in sync and non-contradictory.

## 1. Identify Changes
- Check git diff or recent commits for modified files
- Identify which features/modules were changed
- Note any new files, deleted files, or renamed files

## 2. Verify Current Implementation
**CRITICAL**: DO NOT trust existing documentation. Read the actual code.

For each changed file:
- Read the current implementation
- Understand actual behavior (not documented behavior)
- Note any discrepancies with existing docs

## 3. Update Relevant Documentation

Update README.md and CLAUDE.md with:
- New features or changed behavior
- Updated setup instructions if needed
- New environment variables or dependencies
- New or updated slash commands

## 4. Documentation Style Rules

✅ **Concise** - Sacrifice grammar for brevity
✅ **Practical** - Examples over theory
✅ **Accurate** - Code verified, not assumed
✅ **Current** - Matches actual implementation
✅ **Portable** - CLAUDE.md should work across projects

❌ No enterprise fluff
❌ No outdated information
❌ No assumptions without verification
❌ No project-specific paths in portable docs

## 5. Ask if Uncertain

If you're unsure about intent behind a change or user-facing impact, **ask the user** - don't guess.
