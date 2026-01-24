# Package Code for Review

Create a single markdown file containing all code and context needed for external peer review (ChatGPT, Gemini, etc.).

## How It Works

1. **Ask the user** what they want to package:
   - Full codebase (all files)
   - Just changed files (since last commit or compared to main branch)

2. **Gather information:**
   - Project overview (from README.md)
   - Recent git commits (last 5-10 commits)
   - All relevant source code files
   - Configuration files

3. **Create markdown file** with:
   - Project overview section
   - Recent changes/commits section
   - All code files organized by directory
   - Each file clearly marked with path and content

4. **Save to file** named `review-package-YYYY-MM-DDTHH-MM-SS.md` in project root

## Files to Include

### Always Include (if they exist):
- `README.md` (project overview)
- `CLAUDE.md` (project context)
- `package.json` or `pyproject.toml` (dependencies)
- Main config files for the project type

### Source Code:
- All source files in `src/`, `app/`, `lib/`, or similar directories
- Test files if relevant to the review

### Exclude:
- `node_modules/`, `venv/`, `.venv/`
- Build output (`.next/`, `dist/`, `build/`)
- `.env*` files (secrets)
- Lock files (`package-lock.json`, `poetry.lock`)
- Binary files (fonts, images)
- Generated files

## Markdown Format

```markdown
# Code Review Package

**Generated:** [timestamp]
**Scope:** [Full codebase | Changed files only]

## Project Overview

[Content from README.md]

## Project Context

[Content from CLAUDE.md]

## Recent Changes

[Git commit history - last 5-10 commits with messages]

## Code Files

### [File Path]
\`\`\`[language]
[file content]
\`\`\`

[Repeat for each file]
```

## When User Chooses "Changed Files"

1. Check `git status` for modified/added files
2. If on a branch, compare to `main` branch
3. Only include files that have changed
4. Still include README.md and CLAUDE.md for context
5. Note in the header which files were changed

## Output

- Save file to project root with format: `review-package-YYYY-MM-DDTHH-MM-SS.md`
- Tell user the filename and location
- Show how many files were included
- Optionally show a preview of first few lines

## Remember

- Keep it simple - this is for a non-technical PM
- Explain what you're doing as you go
- Make the markdown easy to copy/paste into ChatGPT or Gemini
- Don't include sensitive files (.env, etc.)
- Ask the user first: "Do you want to package the full codebase or just changed files?"
