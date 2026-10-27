# Technical spec

**Who reads it.** The builder, the reviewer, and whoever fixes a bug later. They need exact names, reasons, and proof that each part works.

**Order**
1. Two or three plain sentences a non-engineer could repeat, linking the PRD.
2. How it works now, and how it will work.
3. Decisions, each with its reason and the option turned down.
4. Interfaces and data: names, inputs, outputs, errors.
5. Steps, each with its check.
6. Risks, rollout, and how to undo.
7. Open questions.

**Rules**
- Link the PRD for the why instead of retelling it.
- Use exact names for files, fields, commands and functions, spelled as in the code. One thing, one name.
- Here the exact term is right: explain one the first time only when a newcomer to the codebase would not know it.
- Give each decision its reason and the rejected option, so nobody reopens it.
- Give every step a check someone can run: a test, a command or a visible result.
- Say which assumptions were checked, and how. Mark the rest unchecked.
- Say how to switch the change off or roll it back.

**Example.** The endpoint is made up; turning a claim into a result someone can check is the rule.
- Before: "The export should be fast and handle large data well."
- After: "`GET /reports/export?month=YYYY-MM` streams CSV. Check: a 50,000-row month downloads in under 30 seconds on the test server. Above 200,000 rows it stops with 'Pick a shorter range.'"
