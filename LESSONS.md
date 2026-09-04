# Lessons Learned (Index)

<!-- One line per lesson: the bold takeaway only. Full write-ups live in LESSONS-detail.md.
     Commands read THIS file at session start (it is short on purpose); when a one-liner is
     relevant to the task at hand, open the matching entry in LESSONS-detail.md for the detail.
     To add a lesson: put the one-liner here under the right section, and the full write-up in
     LESSONS-detail.md with the SAME bold lead so the two stay linked. Keep this file short -
     it is the always-read surface. For deep dives into why a concept works, use /learning-opportunity. -->

## What I Learned

- **XML tags in prompts are a real thing, not just hype.**
- **Hybrid approach beats all-or-nothing.**
- **AI peer review recommendations often over-engineer.**
- **A worktree is just a folder, a branch is just a pointer.**
- **Worktree detection: `--git-dir` vs `--git-common-dir`.**
- **Use deterministic scripts for structural data, not LLMs.** (see the v4.4.0 / issue #97 refinement in detail)
- **Version bumps touch more files than you think.**
- **Never interpolate shell variables into inline `node -e` strings.**
- **`settings.json` can get modified by research subagents.**
- **Permission approvals can land in the wrong settings file.**
- **"Do I understand it?" vs "Can I use it?" is the right split for review skills.**
- **Run debates on plans, not just finished work.**
- **Boundary annotations in few-shot examples teach thresholds, not just format.**
- **DRY refactors create duplication-of-the-other-kind bugs.**
- **Issue framing != actual problem.**
- **Diagnostic output to stderr when stdout is captured by another LLM.**
- **Reasoning models share their token budget between reasoning and output.**
- **Silent empty bodies need active detection, not just happy-path returns.**
- **Per-session temp file paths solve concurrent-tab collisions; session-ID recovery needs to handle the multi-tab case.**
- **Run /ask-gpt and /ask-gemini in parallel when the change is worth real scrutiny; convergence between independent reviewers is signal.**
- **Cross-platform mirrors can hide pre-existing gaps; audit before assuming a small change stays small.**
- **Define a judgement gate once, in countable terms, consistent with its governing rule.**
- **A gate must be countable against the output the model actually produces.**
- **`gh pr list --state merged --limit 1` sorts by CREATION date, not merge date.**
- **HTML output is useless if the user only gets a file link - it opens as source in the editor.**
- **A diff review of already-closed work still earns its keep.**
- **Don't trust merged review severities without verifying the source lines.**
- **Review proposed prompt edits before applying them, and triage the volume hard.**
- **Editing the currently-running command file trips the harness self-modification guard.**
- **The self-modification guard also blocks adding a permission to `settings.local.json`, not just editing the running command.**
- **A prompt's user-facing message is not enforcement.**
- **Pin subagents freely; never switch the main-loop model mid-session.**
- **A release needs one review of the whole range, not the sum of its per-issue reviews.**
- **A version block describes what that version shipped; point at what changed since, never rewrite it.**
- **Numbers quoted in release notes mid-cycle go stale; fill counts in the last verify step.**

## Mistakes to Avoid

- **Fill a plan's Outcomes by replacing the template placeholder, not inserting above it.**
- **Don't micro-tag individual bullets.**
- **Watch for tool output artifacts in reviews.**
- **Review your own AI-generated code before shipping.**
- **Skill tool expansions can serve stale command versions.**
- **AI debates surface things standard reviews miss.**
- **"Same command, two gears" vs "new command" decision pattern.**
- **CLI default-acceptance prompts don't fully translate to chat.**
- **When changing user-facing copy, grep for the same description elsewhere.**
- **Don't state a cited past lesson as if it happened this session.**
- **Guard the symptom, not the one syntax that shipped; and mutation-test the test's own anchors, not just the bug.**
- **Never write a literal HTML comment as an example inside an HTML comment.**
- **When a rule gains an outcome, sweep every paragraph that enumerates outcomes, including the failure-mode one.**
- **A negative-count receipt needs a pattern that cannot match an incidental word.**

### Skills migration decisions (issue #71)

- **Subagents do NOT auto-discover project skills.**
- **Cross-directory file references in skills use `` !`cat ...` `` dynamic injection syntax, not `!include`.**
- **`@axe-core/playwright` is compatible with `playwright-core`.**
- **`user-invocable: false` works as documented.**
- **Shared files reduce duplication across review skills.**
- **GPT and Gemini peer review caught things standard reviews missed.**

### Doc audit + v5.0.0 release (issue #118)

- **Verify audit findings against file content before acting - subagent claims about file structure are not facts.**
- **A major version bump on additive-only work needs explicit framing.**
- **Extending a running rollup beats adding a competing one.**

### WSL opener + Windows installer parity (issues #119, #126)

- **Verify impact, not just existence, before scoping a fix.**
- **A passing happy-path test is not enough - test edge cases, or let adversarial review hunt.**
- **Replacing LLM-run prose with a script removes non-determinism and shrinks the permission surface.**
- **A containment check that compares path strings is not containment.**
- **A test must plant the state a failure actually leaves, not a convenient stand-in.**
- **A file that is both the maintainer's live config and the downstream seed leaks in both directions.**

## Patterns That Work

- **Tag vocabulary for prompts.**
- **Audit before converting.**

### Rename-aware setup cleanup (issue #80)

- **`for i in "${!array[@]}"` is the idiomatic Bash way to iterate parallel indexed arrays.**
- **Scope parity gaps explicitly when fixing one of several.**
- **A 🟩 on "ask the user about X" can mislead.**

### browse.js hardening (issues #82 / #84 / #87)

- **Auto-start lifecycle code is hard to verify without a real dev server.**
- **FS-probes for "is X installed" should fall through, not be authoritative.**
- **Lazy locators don't throw - validate at parse, not at construction.**

### HTML render pipeline (issues #120, #122, #127)

- **Prebuilt shell + data injection: the real #127 win is that a script has no "read-before-overwrite" constraint.**
- **Lift the gold artifact verbatim into a shared tokens file for zero visual regression - but make the mirror bidirectional.**
- **Emit JSON, let a script stamp the boilerplate - it is faster to generate and easier to verify.**

### Plan HTML migration (issue #129)

- **Enforce invariants in code, not just comments - convention-only constraints erode as the codebase grows.**
- **A top-level field list in a prompt reads as exhaustive - sub-field structure must be mentioned or it will be omitted.**

### v5.2.0 release + doc audit (issue #128)

- **Self-enforce release-time conventions in the artifact or the checklist, not in memory.**

### Host-agnostic gh/glab (issue #143)

- **Markdown table escaping leaks into shell commands when the file is inlined with `` !`cat` ``.**
- **A co-location rule is only as strong as its weakest call site.**
- **Inlining a shared fragment AND repeating its content defeats the point of the fragment.**
- **A permission you cannot self-provision may have an already-permitted equivalent.**

### Human-in-the-loop map (issue #146)

- **A self-run consistency check passes while the scoped thing is missing entirely.**

### Auto-by-default rewrite (issue #147)

- **A checked subtask means its wording shipped, not that the nearby diff did.**
- **Call sites paraphrase a shared rule into different behaviors on day one.**

### M2 audit tiers (issue #148)

- **Adding a pipeline stage demands three sweeps: flow prose, data-lifecycle rules, and sibling-stage parity.**

### M11 tripwire hardening (issue #149)

- **A security control passes its own happy-path tests and still fails open - probe it with hostile inputs before trusting its exit code.**
- **Parse tool output with state and explicit decoding, never by prefix alone: content impersonates structure.**
- **Masking the match that triggered the report is not masking the line.**

### Stage chaining (M14)

- **A sweep's receipt is its grep patterns and their output, not the word "clean".**
- **Fixing a drift finding means moving mechanics INTO the shared rule, not adding them at the call site.**

### Severity rubric + audit-aware direct runs (issues #150, #151)

- **A "nothing defines X" finding must first refute the generic rule that already covers X.**
- **Centralizing a rule and hand-writing its call-site preamble in the same commit still drifts - quote the rule or say nothing.**
- **A subagent lost to an account limit resumes as a narrowed retry scoped to what earlier passes did not cover.**

### Subagent model pinning (issue #152)

- **Write the validation bar before the result, then honor it when the result is inconvenient.**
- **A missing finding is invisible to the audit; a wrong one is not.**
- **`failglob` beats `nullglob`, so a nullglob guard does not stop an empty-directory abort.**
- **Restricting an agent's tools is a behavior change, not a safety annotation - check what its callers actually need to run.**

### Second-viewport publishing (issue #154)

- **Check the permission allow-list before designing a mechanism out of shell commands.**
- **`<title>` is RCDATA, so escaping markup inside it changes nothing visible except entities.**
- **A capability-shaped gate can be the honest option for a toolkit shipped to installs you do not control.**

### Viewport inversion + dark mode (issues #155, #156)

- **Mutation-testing a group of assertions is not mutation-testing each assertion.**
- **Tokenising the shared layer does not tokenise its consumers.**
- **A prose sweep needs the wordings that actually occur, not the one you remember writing.**
- **A measurable claim in a commit message is a claim until you measure it.**
- **A pipeline's exit status is the last command's, so `grep | head` always succeeds.**
- **"Falls back" is not "degrades to nothing" - read what the fallback actually produces.**
- **An audit with only pass and kill discards correct findings that carry the wrong label.**

### Correction ledger (issue #157)

- **A filter whose misses are undetectable must reject only the certain non-matches, never guess the matches.**
- **Run your own receipt before you report it as confirmation.**
- **Two halves of one feature, written in one session, can each be right and still not meet.**
- **Harden every field on a whitelist, or the whitelist is not a boundary.**
- **A test whose fixture is rejected by two code paths cannot detect either one breaking.**
- **When storage is append-only, validate the whole batch before writing any of it.**
- **Every fix lands with a check that failed first; a fresh context re-verifies the judgment ones.**

### Design workflow (issue #160)

- **A test fixture must never carry a real-shaped secret; assemble it at runtime, because the tripwire has no allow-list by design.**
- **A contract line that names a recovery path is a claim: ship the flag in the same commit as the sentence.**
- **A prompt cannot declare a user-owned prerequisite done.**
- **Write the return shape first and make the reasoning steps silent, or the contract contradicts itself.**
- **A loop step that needs to know the last iteration in advance cannot be honored; attach it to every iteration.**
- **When inserting a numbered step, grep for every "step N" reference before and after the insertion.**

### Standing page and receipts (issue #162)

- **Render a standing page when its content is final, not when it first becomes available.**
- **A count gate and a standing page cannot coexist: the run with nothing to show is the one that must render.**
- **A fallback the writer drops is not a fallback: stamp derived values on the way in, or every later reader loses them.**
- **Sub-agent output can arrive HTML-escaped; unescape a check before executing anything in it.**
- **A `cd` inside one Bash call persists into the next; start every chained command from the repo root.**

### The standing cycle page (issue #163)

- **A name that is also a key is a migration decision, not a preference.**
- **The design critic finds rendering bugs the test suite cannot see.**
- **An inherited CSS property belongs on the shared root, not copied into each file.**
- **Ask what a change means for repos that already installed the last version, before writing the plan.**
- **Issue framing != actual problem: second occurrence, this time a factual claim rather than a hypothesis.**
