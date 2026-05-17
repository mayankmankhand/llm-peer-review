# Review Output Template

## Base Format

### Top Issues (scannable summary)
```
🚫 X Blocks: R1 (file:line - one-line What), R3 (file:line - one-line What)
⚠️ X Warns: R2 (file:line - one-line What)
💡 X Suggests: R4 (file:line - one-line What)
```

### Looks Good
- [What's working well - 2-3 items]

### Findings

Every finding must include all 4 fields below. No shorthand, no skipping. If a finding is too trivial to justify all 4 fields, do not report it (see the Skip rule in severity-anchors.md).

- **R1** 🚫 `file:line` - [What: the issue in plain English, one line]
  - **Why it matters:** [The harm or risk this creates, in plain language]
  - **Example:** [Real-world impact: what could happen to a user, the system, or a future maintainer if this is not fixed. Be concrete, not abstract.]
  - **Suggested fix:** [The approach to fix it - not the exact code, just the direction]

- **R2** ⚠️ `file:line` - [What]
  - **Why it matters:** [...]
  - **Example:** [...]
  - **Suggested fix:** [...]

### Staff Check
[See Staff Check Variants below for the role matching your review type]

### Summary
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X

## Illustrative Examples

These show what the 4-field structure looks like in practice across different review types. The Example field describes real-world impact, not abstract risk.

### Code review example

- **R1** 🚫 `auth/login.ts:42` - Session token is logged to the console on failed login attempts
  - **Why it matters:** Session tokens in logs let anyone with log access impersonate the user, which defeats the point of authentication
  - **Example:** If an attacker reads the support team's log dashboard during an incident, they get every active session token from the last hour and can log in as those users
  - **Suggested fix:** Log only that a failed attempt occurred, never the credential payload

### UX review example

- **R2** ⚠️ `Dashboard.tsx:88` - Delete button has no confirmation dialog
  - **Why it matters:** Destructive actions without confirmation cause irreversible data loss when a user misclicks
  - **Example:** A user scrolling on mobile taps Delete instead of Edit, loses 30 minutes of unsaved work, and now distrusts the app
  - **Suggested fix:** Add a confirmation modal showing the item name; for batch deletes, require typing the word "delete" to confirm

### Command review example

- **R3** ⚠️ `.claude/commands/explore.md:55` - Phase 2 instruction says "explore the codebase" without specifying what to look for
  - **Why it matters:** Vague instructions let the model wander instead of focusing on the feature; the user gets generic exploration that does not connect to their task
  - **Example:** The model reads every file in src/ instead of just the ones connected to the feature, wasting a 5-minute exploration phase and burning context the user needed for planning
  - **Suggested fix:** Replace the open-ended instruction with a checklist (entry points, dependencies, related files, edge cases) so the model has clear targets

### Suggest example (with skip-boundary annotation)

This example is deliberately on the boundary between "skip-worthy" and "valid Suggest" so the model learns where the line is.

- **R4** 💡 `dashboard/utils.ts:120` - `formatDate` helper duplicates logic already in `lib/datetime.ts`
  - **Why it matters:** Duplicate logic means future date-format changes will be applied in one place and forgotten in the other, causing inconsistent displays across the app
  - **Example:** When the team standardizes on ISO-8601 next quarter, the dashboard helper is updated but the export helper still shows the old format. Users see two different dates for the same record and file a support ticket. Engineering then spends a day tracing which copy is canonical.
  - **Suggested fix:** Replace the local helper with an import from `lib/datetime.ts`; delete the duplicate
  - *Boundary note (for the reviewer):* This is a Suggest, not a skip, because the duplication has real maintainability cost across the codebase (two places to update, drift risk over time). It would be skipped under the Skip rule if it were a one-line helper used only inside a single isolated module - small, local duplication is not worth a 4-field report.

## Staff Check Variants

| Domain | Staff Role | Focus |
|--------|-----------|-------|
| Code | Staff Engineer | Right approach? Shortcuts to clean up? What would you push back on? |
| UX | Staff Designer | Coherent experience? User confidence? Edge cases (empty, loading, error, first-time)? |
| Plan | Staff PM (scope) | Scope discipline? Acceptance completeness? Traceability? Delivery risk? |
| Commands | Staff PM (ops) | Any user can follow? Workflow reliability? Handoff quality? |
| Browser | Staff QA | Core flow works? Error handling? Console health? Network health? |
| Full | Staff Architect | Cross-domain conflicts? Release risk? What's missing? Deeper reviews needed? |
| Deps | Security Engineer | Known vulnerabilities? Supply chain risk? License compliance? Update urgency? |
| Copy | Staff Editor | Clear to a newcomer? Oriented before interaction? Plain language? What would you send back for revision? |

## Browser Review Extensions

Browser findings use the same 4-field structure plus extra evidence fields:

- **R1** 🚫 `page/route` - [What: the issue in plain English]
  - **Why it matters:** [The harm or risk this creates for users]
  - **Example:** [Real-world impact: what a user would experience]
  - **Screenshot:** [Path to screenshot showing the issue]
  - **Evidence:** [Console errors, failed API calls, or text output that supports the finding]
  - **Expected:** [What should happen]
  - **Actual:** [What actually happens]
  - **Suggested fix:** [The approach to fix it]

Browser summary also includes:
- Pages tested: X
- Browser sessions run: X
- Blocks: X | Warns: X | Suggests: X
