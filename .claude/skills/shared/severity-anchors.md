# Severity Anchors

## Severity Levels

- 🚫 **Block** - Will break the app or block users. Must fix before shipping.
- ⚠️ **Warn** - Should fix before shipping. Risk of bugs, debt, or user frustration.
- 💡 **Suggest** - Nice to have. Improves quality but not urgent.

## Universal Anchors (all review types)

These categories have minimum severity floors - never downgrade them:

- Exposed secrets, insecure auth, or injection risks = always at least **Warn**, usually **Block**
- Data loss or irreversible user harm without safeguards = always at least **Warn**
- Accessibility failures blocking keyboard/screen-reader on primary tasks = always at least **Warn**
- Committed requirements plainly unmet = always at least **Warn**

## Domain-Specific Weighting

### Code Review

- Security vulnerabilities and data-loss risks = lean toward **Block**
- Performance issues in hot paths = lean toward **Warn**
- Style and naming = lean toward **Suggest** unless it harms readability

### UX Review

- Accessibility violations that block primary tasks = lean toward **Block**
- Missing error states or destructive actions without confirmation = lean toward **Warn**
- Visual polish and minor consistency issues = lean toward **Suggest**

### Plan Review

- Plan task marked done but not actually implemented = lean toward **Block**
- Undocumented scope changes or cuts = lean toward **Warn**
- Minor deviations that improve on the plan = lean toward **Suggest**

### Command Review

- Conflicting or ambiguous instructions that will mislead the AI = lean toward **Block**
- Missing steps in a workflow = lean toward **Warn**
- Wording improvements or formatting polish = lean toward **Suggest**

### Browser Review

- Page crashes, blank screens, or broken core flows = lean toward **Block**
- Console errors, failed API calls, or layout issues on main pages = lean toward **Warn**
- Minor visual glitches or slow loading = lean toward **Suggest**

### Full Review

- Cross-domain conflicts (e.g., code works but UX breaks, or plan says X but implementation does Y) = lean toward **Block**
- Missing rollback plan or deployment risk = lean toward **Warn**
- Single-domain polish items = lean toward **Suggest** and recommend the specialist command

### Dependency Review

- Known CVEs in dependencies = lean toward **Block**
- Outdated packages with known issues = lean toward **Warn**
- License concerns or single-maintainer packages = lean toward **Suggest**

### Copy Review

- Reader cannot determine what the content is, who it is for, or what an action means before a consequential action = lean toward **Block**
- Understanding is possible but delayed, jargon-heavy, or unnecessarily effortful = lean toward **Warn**
- Wording or structure could be improved but core orientation is intact = lean toward **Suggest**
