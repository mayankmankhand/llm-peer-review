# Review Output Template

## Base Format

### Top Issues (scannable summary)
```
🚫 X Blocks: R1 (file:line - one-line description), R3 (file:line - one-line description)
⚠️ X Warns: R2 (file:line - one-line description)
💡 X Suggests: R4 (file:line - one-line description)
```

### Looks Good
- [What's working well - 2-3 items]

### Findings

- **R1** 🚫 `file:line` - [Issue description in plain English]
  - **Why:** [Why this matters]
  - **Fix direction:** [What to change - not the exact code, just the approach]

- **R2** ⚠️ `file:line` - [Issue description]
  - **Why:** [Why this matters]
  - **Fix direction:** [Approach]

### Staff Check
[See Staff Check Variants below for the role matching your review type]

### Summary
- Files reviewed: X
- Blocks: X | Warns: X | Suggests: X

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

Browser findings use an expanded format with extra fields:

- **R1** 🚫 `page/route` - [Issue description in plain English]
  - **Screenshot:** [path to screenshot showing the issue]
  - **Why:** [Why this matters to users]
  - **Evidence:** [Console errors, failed API calls, or text output that supports the finding]
  - **Expected:** [What should happen]
  - **Actual:** [What actually happens]
  - **Fix direction:** [What to change - not the exact code, just the approach]

Browser summary also includes:
- Pages tested: X
- Browser sessions run: X
- Blocks: X | Warns: X | Suggests: X
