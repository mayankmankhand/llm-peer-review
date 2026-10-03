# Codebase to Course

Turn any codebase into a visual learning guide.

**Use this when:** You want to understand a codebase, dependency, or project by turning it into an interactive, browsable learning artifact.
**Don't use this when:** You just need a quick explanation (use /learning-opportunity instead).

## What This Creates

A single self-contained HTML file that teaches a codebase through interactive modules. Each module covers a part of the architecture with plain English explanations, side-by-side code walkthroughs, visual diagrams, and comprehension questions. Open the file in any browser - no server or dependencies needed.

## How It Works

<procedure>

1. Analyze the codebase structure (entry points, key files, architecture)
2. Identify the learning modules from the codebase's architecture: one per major part, as many as the codebase has
3. For each module, create:
   - Plain English explanation of what this part does and why
   - Code walkthrough with side-by-side English translations
   - Visual diagram showing how this module connects to others
   - 2-3 comprehension questions
4. Generate a single self-contained HTML file with:
   - Navigation sidebar
   - Module pages with code + explanation side by side
   - Simple embedded diagrams (using inline SVG or ASCII)
   - Interactive quiz questions with reveal-answer toggles
5. Save it as `course.html` in a fresh folder from `mktemp -d /tmp/codebase-course.XXXXXX`, made and used per "Temporary folders" in `.claude/skills/shared/html-outputs.md`
6. Open it in the user's browser with `bash .claude/scripts/open-artifact.sh <the course.html path>`, typing the path `mktemp` printed, then tell the user where it is. The course is written by hand rather than by `render-html.js`, so it opens locally and is not published. If the script exits 1, relay the guidance it prints instead of retrying

</procedure>

## Target Audience

<guidelines>

Non-engineers who build with AI tools. Assume the reader:
- Can read code but doesn't write it professionally
- Understands basic programming concepts (variables, functions, APIs)
- Wants to understand WHY the code is structured this way, not just WHAT it does
- Benefits from analogies and visual explanations

</guidelines>

## Output Guidelines

<rules>

- Self-contained: one HTML file, no external dependencies
- Each module should take 5-10 minutes to read
- Use metaphors and analogies from everyday life
- Show code in small, digestible chunks (10-20 lines max per block)
- Include a "How it all fits together" summary at the end

</rules>

## HTML Output Rules

Every HTML decision above (whether to render, where the file lands, the temporary folder) is governed by the shared rules fragment, inlined here so it is in context when the course is written.

!`cat .claude/skills/shared/html-outputs.md`
