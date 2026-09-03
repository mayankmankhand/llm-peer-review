# Severity Anchors

## What Severity Decides

Severity is a routing label, not a ranking of how much you care. Four things read it:

- **The M2 audit tier** - a Block gets three independent skeptics, a Warn or Suggest gets one. Over-calling a Block costs two extra subagents on every run that carries it. Since v6.1.1 (#158) those three voters can also downgrade an over-called Block to Warn or Suggest instead of killing it, so over-calling costs the run two skeptics and no longer costs the finding.
- **The Overall Verdict line** - any surviving Block makes the report `changes-requested`.
- **The R-ID order** - findings are numbered Blocks first, then Warns, then Suggests.
- **The readability backstop** - past 7 findings, the 5 highest-severity ones lead the report in full.

Severity does **not** decide whether a human is interrupted. Paging is governed by M1 in `.claude/skills/shared/hitl-loop.md`, which routes on where the answer lives - facts only the user holds, a reversal of deliberate intent, a hard stop - and deliberately ignores severity, because a self-assigned label is unreliable in both directions. Do not reach for a higher level to get someone's attention: it will not, and it will cost the run two extra skeptics.

## Skip These Entirely

Before assigning severity, decide whether the finding is worth reporting at all.

**Rule:** if a finding is purely cosmetic with no functional, security, accessibility, or maintainability impact, drop it. The test is the inverted skip rule in `output-template.md`: a finding must survive being compressed to one sentence with an honest harm verb in it. A cosmetic item has no such verb, so it fails the test and is dropped. Never reach for an overstated verb to keep it alive.

Skip-worthy items:
- Pure typos in non-user-facing comments or internal variable names
- Trailing whitespace, missing trailing newlines, indentation off by one space
- Missing periods at the end of code comments
- Single-character variable names in short scopes (e.g., `i` in a 3-line loop)
- Stylistic preferences with no readability impact (e.g., single vs double quotes in an already-mixed file)

**Exception:** the Universal Anchors below override this rule when relevant. A typo in user-facing copy, a whitespace change in whitespace-sensitive YAML or Python, or a "trivial" variable name that masks a security issue should still be reported with the appropriate severity.

**Why this rule exists:** every reported finding should feel justified to the user, even at Suggest level. The rule prevents bulked-up nonsense findings that erode trust in the review.

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

## Calibrate to the Project

The same defect does not carry the same weight everywhere. Before assigning a level, decide which of these you are looking at, and adjust once:

- **Solo or local tool** - a personal script, a toolkit run from one machine, a prototype whose only user is its author. The blast radius is one person who can undo anything. Scale-and-hardening findings (no rate limiting, no retry budget, no audit trail, a single point of failure, missing observability) land a level lower than instinct suggests, and often fail the Skip rule outright.
- **Production service** - real users, real data, a deploy other people depend on. The same findings land where instinct suggests. Bump one level only when both halves of the production risk are present: the failure would strike unattended AND it reaches users who cannot undo it themselves. One of the two is not enough - that pairing, not the word "production", is what earns the bump.

Judge this from what is actually in front of you - a deploy config, an auth layer, a database holding real records, a README describing users - not from how polished the code looks. A well-built local tool is still a local tool.

**The Universal Anchors above are floors and survive this adjustment.** An exposed secret in a solo tool is still at least a Warn: the secret leaks the same way regardless of who runs the script. Project context moves the ceiling, never the floor.

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

## Boundary Examples

Three lines decide most disagreements, and each is taught by one worked example rather than a list of rules. The **skip-vs-Suggest** line is taught in `output-template.md` by finding R4; the two below cover the rest, numbered R10 and R11 - above every ID the template's own illustrative blocks use - so nothing collides when both fragments load into the same context. Read the boundary note, not just the finding: the note is the lesson, and it names what would have to change for the finding to move across the line.

### Block vs Warn

- **R10** 🚫 `api/export.ts:64` - Blocks. A large export exhausts memory and stops the server for everyone.
  - It fires on the first account with enough records, and it takes down users who did nothing.
  - **Fix:** One function: stream rows instead of buffering. An afternoon, or restore the cap that was removed.
  - *Boundary note (for the reviewer):* This is a **Block**, not a Warn, on three counts: the failure is reachable through a normal user action on data that already exists, it harms users other than the one who triggered it, and there is no workaround available to them. Drop any one of those and it becomes a **Warn** - if the crash were confined to the requesting user's own session, or if it needed a record count no account in the system currently has, it is a real risk that has not yet become a certainty. These three counts are also exactly what a tier-3 `DOWNGRADE` vote must name (M2): a downgrade that cannot say which one fails counts as `STANDS`.

### Warn vs Suggest

- **R11** ⚠️ `settings/ProfileForm.tsx:112` - Should fix. A failed save silences the error and clears the form anyway.
  - The user walks away believing a change saved, and finds out weeks later.
  - **Fix:** One branch: keep the values and say what failed. Ten minutes, or leave people misinformed.
  - *Boundary note (for the reviewer):* This is a **Warn**, not a Suggest, because the user is misinformed and loses input they already typed. That is user frustration with a concrete cost, not polish. It would be a **Suggest** if the failure were already visible - say the form showed a generic "Something went wrong" and kept the values, and the finding were only that the message could name the offending field. A working message that could be better is a Suggest; a message that never appears at all is a Warn.
