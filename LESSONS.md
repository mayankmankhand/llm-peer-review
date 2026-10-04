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
- **A prose sweep needs the wordings that actually occur, not the one you remember writing.** (see the #206 and #208 refinements in detail)
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
- **A stable page that is never refreshed is worse than no page: one durable URL, and everything at it false.**

### The standing cycle page (issue #163)

- **A name that is also a key is a migration decision, not a preference.**
- **The design critic finds rendering bugs the test suite cannot see.**
- **An inherited CSS property belongs on the shared root, not copied into each file.**
- **Ask what a change means for repos that already installed the last version, before writing the plan.**
- **Issue framing != actual problem: second occurrence, this time a factual claim rather than a hypothesis.**

### Tripwire credential patterns (issue #164)

- **A detection pattern must be tested against ordinary prose, not only against what it hunts.**
- **A fixture has to dodge every pattern in the scanner, not just the one it is a fixture for.**
- **The comment justifying an exclusion is load-bearing: if it is wrong, the exclusion is unguarded.**
- **Release counts go stale a second time when the fix loop itself changes them; re-sweep after the loop, never before.**

### Permission seeding and the netrc exemption (issues #165, #166)

- **Copying a script and permitting it are two edits, and only the missing copy is loud.**
- **A caveat in release notes is a deferred defect, not a resolution.**

## Issue 167 (v7.0.0, the plugin)

- **An agent file written mid-session is not dispatchable until the session reloads it.**
- **Preload beats paste: a `skills:` line loads a skill into the subagent byte for byte, and nested inline-cats do not expand.**
- **Review a plan this size with three fresh lenses before executing it.**
- **A suite is green when its exit code is 0, not when its tail looks quiet.**

## Issue 168 (v7.0.1, mangled mail links)

- **A test for a false-positive fix must use a fixture the old pattern actually matched, and assert the thing only the fix changes.**
- **A plugin install updates only on a version change, so fixes committed after a tag reach no existing install until the next bump.**

## Issues 172-177 (v7.1.0, safe distribution)

- **An end-to-end test harness must isolate every global registry a session touches, not only the plugin it loads.**
- **A user interrupt also stops running workflow agents, and nothing announces it.**
- **A safety baseline must check what the test can change, not the bytes of files the owner's own sessions also write.**
- **Dry-running an upgrade on scratch copies of real projects finds defects that synthetic scenarios cannot.**
- **Test an undo instruction by executing it, not by matching its text.**
- **A receipt that cites line numbers stops proving anything once a fix moves the code; re-verify the claim, not the old range.**

## Issues 178-183 (v7.2.0, the review sees the work)

- **Keep verification evidence in the repo as it lands; this machine clears `/tmp` and the scratchpad between days.**
- **Isolate a headless test session's whole home, not only its plugin: a scratch `HOME` is the complete fix.**
- **Headless sessions cannot edit files under `.claude/` outside bypassPermissions; decide how a prompt-file flow is proven before running it.**
- **A plugin CLI command run inside a project also edits that project's settings file.**
- **A rewrite keyed on names must be tested on file names that contain those names.**

## Issue 184 (7.3.0, the regression audit)

- **A build that scopes names and permissions for one distribution leaves the other behind unless the same sweep runs over its files.**
- **Prove a harness with the thing it will be used for, not with a trivial prompt.**
- **Generate a long report from parts with one script; never append into a file that is also its own source.**
- **A dispatched finder cannot ask, so a criterion that opens with a question returns nothing.**
- **Read the skeptic's split lines: a refuted row often carries the real defect in a narrower claim.**

## Issues 185-194 (7.3.1, the follow-ups)

- **A leading wildcard in a permission row widens what the row trusts, not just where the file lives; measure the hostile form before shipping the row.**
- **A rewrite to a link that moves only at session start breaks an update taken mid-session; measure the same-session update path.**
- **Replacing a detection pattern can drop a hit only the old one had; add the new rule beside it and rerun every hostile fixture.**

## Issue 199 (project extension seams)

- **An inline read of a missing file is not an empty string: Claude Code inserts its own "no output" note, so label every optional read.**
- **Measure a new inline command form in a real default-mode session before building on it; a shell exit code says nothing about the harness.**
- **Find a rule's consumers by who applies it, not by who inlines it, and never count them through a `head`.**
- **A check that defers to another check must ask whether that other check runs in this range.**
- **In a scripted edit, pass `String.replace` a function: a `$'` in the new text splices the rest of the file in.**

## Issues 196, 200, 202 (the outside audit)

- **A new rule written for the orchestrator stops one step short of its neighbors: second occurrence of "find a rule's consumers by who applies it".**
- **Git accepts any unambiguous prefix of a long option, so a permission row on the full word misses the short spellings.**
- **A permission rule ending in `:*` is read as the older prefix spelling and never matches a literal colon.**
- **"Binary files differ" is git's reading of the attributes, not of the content; check the bytes before staying silent.**
- **"Touches no file" is a claim to measure: `git stash create` takes the index lock.**
- **An everyday test command cannot be the release gate, because the gate's version checks fail on purpose between releases.**

## Issues 195, 197, 201 (wave 2: things that fail in a confusing way)

- **Prove a test stub takes before trusting the checks built on it; a read-only property swallows a plain assignment.**
- **When a prompt spells out a placeholder's value, grep every later use of that placeholder or the model improvises the rest.**
- **A live check on the friendliest fixture proves the friendly case; write the check against the row the rules actually allow.**

## Issue 203 (the silent middle)

- **`plugin update` follows a pointer that `marketplace update` moves; one without the other is a no-op.**
- **A gate that lists the signals it cares about is another silent middle; read the record the code already computes.**
- **An assertion for ABSENCE cannot go red before the fix, so it guards against later widening, never against the bug it was written for.**
- **A fixture that already satisfies one term of a compound gate cannot tell that term from the others; build the fixture from the gate, not from what is nearby.**

## Issue 204 (judges return gaps, not grades)

- **A judge validated on the fallback agent is not validated as shipped: the fallback's extra tools let it compare bytes instead of looking.**
- **A fixture that fails on both pages tells them apart no better than one that passes on both; every-frame redraws made the good page's Delete unclickable too.**
- **Give a finder a neutral copy of what it judges: a fixture's name and comments state the answer, and a finder with Grep will read the plan.**
- **Commit by who verifies it: a revert a screenshot judge decides must only take changes a screenshot can show.**
- **When a rule gains a condition or a trigger, follow it to every restatement and every gate on its path.**
- **A line telling one stage to read a field from another stage's output is a claim: check the producer's template has that field.**
- **A score that wobbles a point on unchanged input cannot drive a loop; the gaps it returns can.**

## Issue 206 (prompt-audit cleanup)

- **The bundled prompt audit is not deterministic: a rerun on unchanged text finds new items, so no rerun proves a list is complete.**
- **Smoke-test a new on-demand skill in default permission mode: only that mode shows a missing permission row.**
- **Build a smoke test's plugin into a cache-shaped folder, or setup drops the plugin's script rows and an allowed call looks denied.**
- **In an unattended run, one denied call can make the model skip a later, different call without trying it; tell test sessions to judge each call on its own.**

## Issues 205 and 207 (model modes, the quality check)

- **A plan that promises a one-commit revert must say what happens once later work moves the text.**
- **A model named in a helper's file is relative to the session that dispatches it: on a cheaper session it lands above the judges, so cap it at the session model.**
- **An agent with no `model:` line follows `CLAUDE_CODE_SUBAGENT_MODEL`; a role that must stay on the session model says `model: inherit`.**
- **A cheaper helper that finishes faster may simply have read less: score what it covered, not only its cost and time.**
- **Hold a cheaper model to a known-answer case taken from a real miss; an easy fixture passes everything.**
- **Change a scorer's answer key only with a rescore of every saved run, and report exactly which catches moved.**
- **Making cleanup tolerate a failure moves it from "the run stopped" to "the run is judged on partial evidence": carry the failure into the verdict.**
- **A test that a timeout kills a child must bound the time too: while the orphan holds the output pipe, the wait ends only when the child finishes on its own.**
- **A tripwire on the owner's config must tell the owner's other sessions from the run: shared append-only logs grow while a test runs.**
- **In this shell `grep` is ugrep, which reads a `$` inside a pattern as an anchor: grep for literal text with a `$` using `-F`.**

## Issue 208 (three small gaps)

- **The plugin build rewrites command names in prompts, never in scripts: wording moved into a script must name no command.**
- **Before engineering a smarter limit, lift the old one once and see whether it binds.**

## Issue 209 (your own helpers' models)

- **A detector's "this one is fine" rule must be as narrow as the text it recognizes: the audit after it can drop a reported finding, never add a missed one.**
- **A detector that copies two lists from another file needs a drift check on each; pinning the first does not cover the second.**
