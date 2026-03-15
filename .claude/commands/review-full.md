# Full Review Task - Pre-Release Check

Mile wide, inch deep. Cross-domain release readiness, not a deep specialist review.

**Use this when:** Pre-release gate, major milestone check, or when multiple domains changed significantly and you need a single go/no-go assessment.
**Don't use this when:** You need deep review of one area - use /review-code, /review-commands, /review-plan, /review-ux, or /review-browser instead. This command will recommend which specialist review to run if it finds areas needing deeper attention.

## CRITICAL RULES
<rules>
1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - I'm a PM learning to code, use plain English
4. **Don't duplicate specialist reviews** - Prioritize cross-domain issues, release blockers, and interactions between code, UX, scope, and operations. If something needs deeper investigation, recommend which specialist command to run next.
</rules>

## How to Review
<procedure>
Read the changed files and any relevant plan file. Auto-detect the most recently modified `PLAN-*.md` in `.claude/plans/` (also check the project root for legacy plan files). If no plan file exists, skip plan comparison and note it in the summary. If multiple plan files exist and the most recent one is not clearly complete (all tasks checked off), pause and ask the user which plan to evaluate against.

Then pick one of two modes:

**Small change** (1-2 files, minor update): Review in a single pass. No sub-agents needed.

**Bigger change** (3+ files or significant feature): Run four focused sub-agents in parallel using the Agent tool, then combine their results:

| Sub-agent | What it checks |
|-----------|----------------|
| **Code & Architecture** | Security red flags, architectural soundness, obvious logic issues, performance risks |
| **Design & Completeness** | Plan alignment, feature gaps, scope drift, test coverage, docs updated |
| **UX & Accessibility** | Usability quick-check, WCAG AA basics, error states, key user flows |
| **Operations** | Secrets in code, logging/monitoring, deployment readiness, rollback plan |

Each sub-agent should stay broad. If a sub-agent finds something that needs deep investigation, flag it and recommend the appropriate specialist review command.

Each sub-agent should use the severity scale and Finding ID format below. If a sub-agent has no findings, it should report "No issues found" so the user knows it ran.
</procedure>

## Severity Levels
<reference>
- 🚫 **Block** - Release blocker. Cannot ship with this issue.
- ⚠️ **Warn** - Should address before release. Risk to users or operations.
- 💡 **Suggest** - Worth improving but not a release blocker.

<!-- Shared block - keep in sync with other review-*.md files -->
**Severity anchors (apply to all review types):**
These categories have minimum severity floors - never downgrade them:
- Exposed secrets, insecure auth, or injection risks = always at least **Warn**, usually **Block**
- Data loss or irreversible user harm without safeguards = always at least **Warn**
- Accessibility failures blocking keyboard/screen-reader on primary tasks = always at least **Warn**
- Committed requirements plainly unmet = always at least **Warn**

**Full review weighting:**
- Cross-domain conflicts (e.g., code works but UX breaks, or plan says X but implementation does Y) = lean toward **Block**
- Missing rollback plan or deployment risk = lean toward **Warn**
- Single-domain polish items = lean toward **Suggest** and recommend the specialist command
</reference>

## Finding IDs

<reference>
Every finding gets a unique ID: **R1**, **R2**, **R3**, etc. This lets the user say "fix R2 and R5" to approve specific fixes. When combining results from sub-agents, renumber all findings into a single R1, R2, R3 sequence.
</reference>

## Output Format
<output_format>
### Top Issues (scannable summary)
```
🚫 2 Blocks: R1 (file:line - one-line description), R3 (file:line - one-line description)
⚠️ 1 Warn: R2 (file:line - one-line description)
💡 1 Suggest: R4 (file:line - one-line description)
```

### ✅ Looks Good
- [What's working well - 2-3 items]

### 🔍 Findings

- **R1** 🚫 `file:line` - [Issue description in plain English]
  - **Why:** [Why this matters]
  - **Fix direction:** [What to change - not the exact code, just the approach]

- **R2** ⚠️ `file:line` - [Issue description]
  - **Why:** [Why this matters]
  - **Fix direction:** [Approach]
</output_format>

### 🏗️ Staff Architect Check
<guidelines>
After the standard review, step back and evaluate as a staff architect:
- **Cross-domain conflicts?** - Do code, UX, plan, and operations all tell the same story?
- **Release risk** - What's most likely to go wrong in production?
- **What's missing?** - Monitoring, rollback, documentation, user communication?
- **Deeper reviews needed?** - Recommend specific /review-* commands for areas that need more attention
</guidelines>

### Release Recommendation
State one of:
- **Ready** - No blockers, ship it
- **Ready with conditions** - Ship after addressing [specific items]
- **Not ready** - Must fix [specific blockers] before release

### 📊 Summary
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X

<rules>
## REMEMBER: Report issues only. Do NOT edit any files until I approve.
</rules>
