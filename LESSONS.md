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
- **Use deterministic scripts for structural data, not LLMs.**
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
- **Run /ask-gpt and /ask-gemini in parallel on a change worth real scrutiny; treat a gap both raise as real.**
- **Cross-platform mirrors can hide pre-existing gaps; audit before assuming a small change stays small.**
- **Define a judgement gate once, in countable terms, consistent with its governing rule.**
- **A gate must be countable against the output the model actually produces.**
- **Review proposed prompt edits before applying them, and triage the volume hard.**
- **Editing the currently-running command file trips the harness self-modification guard.**
- **The self-modification guard blocks adding a permission to `settings.local.json`; ask the user to add it.**
- **A prompt's user-facing message is not enforcement.**
- **Pin subagents freely; never switch the main-loop model mid-session.**
- **A release needs one review of the whole range, not the sum of its per-issue reviews.**
- **A version block describes what that version shipped; point at what changed since, never rewrite it.**

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

- **Cross-directory file references in skills use `` !`cat ...` `` dynamic injection syntax, not `!include`.**
- **Shared files reduce duplication across review skills.**

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
- **Scope parity gaps explicitly when fixing one of several.**
- **A 🟩 on "ask the user about X" can mislead.**

### browse.js hardening (issues #82 / #84 / #87)

- **Auto-start lifecycle code is hard to verify without a real dev server.**
- **FS-probes for "is X installed" should fall through, not be authoritative.**
- **Lazy locators don't throw - validate at parse, not at construction.**

### HTML render pipeline (issues #120, #122, #127)

- **Prebuilt shell + data injection: the real #127 win is that a script has no "read-before-overwrite" constraint.**
- **Lift the gold artifact verbatim into a shared tokens file, and make each file point at the other.**
- **Emit JSON, let a script stamp the boilerplate - it is faster to generate and easier to verify.**

### Plan HTML migration (issue #129)

- **Enforce invariants in code, not just comments - convention-only constraints erode as the codebase grows.**
- **A top-level field list in a prompt reads as exhaustive - sub-field structure must be mentioned or it will be omitted.**
- **Self-enforce release-time conventions in the artifact or the checklist, not in memory.**

### Host-agnostic gh/glab (issue #143)

- **Markdown table escaping leaks into shell commands when the file is inlined with `` !`cat` ``.**
- **A co-location rule is only as strong as its weakest call site.**
- **Inlining a shared fragment AND repeating its content defeats the point of the fragment.**
- **A permission you cannot self-provision may have an already-permitted equivalent.**

### Auto-by-default rewrite (issue #147)

- **A checked subtask means its wording shipped, not that the nearby diff did.**
- **Call sites paraphrase a shared rule into different behaviors on day one.**
- **Adding a pipeline stage demands three sweeps: flow prose, data-lifecycle rules, and sibling-stage parity.**

### M11 tripwire hardening (issue #149)

- **Probe a security control with hostile inputs before trusting its exit code, and confirm it fails closed.**
- **Parse tool output with state and explicit decoding, never by prefix alone: content impersonates structure.**
- **Masking the match that triggered the report is not masking the line.**

### Stage chaining (M14)

- **A sweep's receipt is its grep patterns and their output, not the word "clean".**
- **Fixing a drift finding means moving mechanics INTO the shared rule, not adding them at the call site.**

### Severity rubric + audit-aware direct runs (issues #150, #151)

- **A "nothing defines X" finding must first refute the generic rule that already covers X.**
- **When centralizing a rule, make each call site quote it verbatim or say nothing beyond what is local.**
- **A subagent lost to an account limit resumes as a narrowed retry scoped to what earlier passes did not cover.**

### Subagent model pinning (issue #152)

- **Write the validation bar before the result, then honor it when the result is inconvenient.**
- **A missing finding is invisible to the audit; a wrong one is not.**
- **`failglob` beats `nullglob`, so a nullglob guard does not stop an empty-directory abort.**
- **Narrowing an agent's tools changes behavior: first check what every caller dispatching through it runs.**

### Second-viewport publishing (issue #154)

- **Check the permission allow-list before designing a mechanism out of shell commands.**
- **`<title>` is RCDATA, so escaping markup inside it changes nothing visible except entities.**
- **A capability-shaped gate can be the honest option for a toolkit shipped to installs you do not control.**

### Viewport inversion + dark mode (issues #155, #156)

- **Mutation-testing a group of assertions is not mutation-testing each assertion.**
- **Tokenising the shared layer does not tokenise its consumers.**
- **A prose sweep needs the wordings that actually occur, not the one you remember writing.**
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
- **A stable page that is never refreshed is worse than no page: one durable URL, and everything at it false.**

### The standing cycle page (issue #163)

- **A name that is also a key is a migration decision, not a preference.**
- **The design critic finds rendering bugs the test suite cannot see.**
- **An inherited CSS property belongs on the shared root, not copied into each file.**
- **Ask what a change means for repos that already installed the last version, before writing the plan.**

### Tripwire credential patterns (issue #164)

- **A fixture has to dodge every pattern in the scanner, not just the one it is a fixture for.**
- **The comment justifying an exclusion is load-bearing: if it is wrong, the exclusion is unguarded.**

### Permission seeding and the netrc exemption (issues #165, #166)

- **Copying a script and permitting it are two edits, and only the missing copy is loud.**
- **A caveat in release notes is a deferred defect, not a resolution.**

## Issue 167 (v7.0.0, the plugin)

- **An agent file written mid-session is not dispatchable until the session reloads it.**
- **Preload a skill into a subagent with a `skills:` line, not a paste, and never nest inline-cats.**
- **Review a plan this size with three fresh lenses before executing it.**
- **A suite is green when its exit code is 0, not when its tail looks quiet.**

## Issue 168 (v7.0.1, mangled mail links)

- **Test a false-positive fix on a fixture the old pattern matched, and assert what only the fix changes.**
- **A plugin fix made after a tag reaches installs only with the next version: bump now or say so in the notes.**

## Issues 172-177 (v7.1.0, safe distribution)

- **A user interrupt also stops running workflow agents, and nothing announces it.**
- **A safety baseline must check what the test can change, not the bytes of files the owner's own sessions also write.**
- **Dry-running an upgrade on scratch copies of real projects finds defects that synthetic scenarios cannot.**
- **Test an undo instruction by executing it, not by matching its text.**
- **When a fix moves code, re-verify a line-number receipt's claim on the new code, not the old range.**

## Issues 178-183 (v7.2.0, the review sees the work)

- **Keep verification evidence in the repo as it lands; this machine clears `/tmp` and the scratchpad between days.**
- **Isolate a headless test session's whole home, not only its plugin: a scratch `HOME` is the complete fix.**
- **Headless runs edit `.claude/` only in bypassPermissions; decide how a prompt-file flow is proven beforehand.**
- **A plugin CLI command run inside a project also edits that project's settings file.**
- **A rewrite keyed on names must be tested on file names that contain those names.**

## Issue 184 (7.3.0, the regression audit)

- **When a build rewrites names or permissions for one distribution, run the same sweep over the other's files.**
- **Prove a harness with the thing it will be used for, not with a trivial prompt.**
- **Generate a long report from parts with one script; never append into a file that is also its own source.**
- **A dispatched finder cannot ask, so a criterion that opens with a question returns nothing.**
- **Read the skeptic's split lines: a refuted row often carries the real defect in a narrower claim.**

## Issues 185-194 (7.3.1, the follow-ups)

- **Before shipping a permission row with a leading wildcard, test which hostile commands it also allows.**
- **Before pointing call sites at a link moved only at session start, test an update taken mid-session.**
- **When changing a detection pattern, add the new rule beside the old one and rerun every hostile fixture.**

## Issue 199 (project extension seams)

- **Label every optional inline read, so a missing file's "no output" note cannot pass for content.**
- **Before building on a new inline command form, measure it in a real default-mode session, not a shell.**
- **Find a rule's consumers by who applies it, not by who inlines it, and never count them through a `head`.**
- **A check that defers to another check must ask whether that other check runs in this range.**
- **In a scripted edit, pass `String.replace` a function: a `$'` in the new text splices the rest of the file in.**

## Issues 196, 200, 202 (the outside audit)

- **A rule written for the orchestrator must reach every runner that applies it: list them and check each one.**
- **Git accepts any unambiguous prefix of a long option, so a permission row on the full word misses the short spellings.**
- **A permission rule ending in `:*` is read as the older prefix spelling and never matches a literal colon.**
- **"Binary files differ" is git's reading of the attributes, not of the content; check the bytes before staying silent.**
- **"Touches no file" is a claim to measure: `git stash create` takes the index lock.**
- **An everyday test command cannot be the release gate, because the gate's version checks fail on purpose between releases.**

## Issues 195, 197, 201 (wave 2: things that fail in a confusing way)

- **Prove a test stub takes before trusting the checks built on it; a read-only property swallows a plain assignment.**
- **When a prompt spells out a placeholder's value, grep each later use of it and spell those out too.**
- **Write a live check against the least helpful row the rules allow, not the friendliest fixture.**

## Issue 203 (the silent middle)

- **`plugin update` follows a pointer that `marketplace update` moves; one without the other is a no-op.**
- **A gate that lists the signals it cares about is another silent middle; read the record the code already computes.**
- **Build a compound gate's fixture from the gate, so that only the term under test decides the result.**

## Issue 204 (judges return gaps, not grades)

- **Before trusting a check meant to tell a defect from its fix, run it on both and confirm the answers differ.**
- **Give a finder a neutral copy of what it judges, with no telling names or comments and the plan out of reach.**
- **Commit by who verifies it: a revert a screenshot judge decides must only take changes a screenshot can show.**
- **When a rule gains a condition or a trigger, follow it to every restatement and every gate on its path.**
- **When a prompt has one stage read a field from another stage's output, check the producer's template has it.**
- **A score that wobbles a point on unchanged input cannot drive a loop; the gaps it returns can.**

## Issue 206 (prompt-audit cleanup)

- **The bundled prompt audit is not deterministic, so no rerun of it proves a list is complete.**
- **Smoke-test a new on-demand skill in default permission mode: only that mode shows a missing permission row.**
- **Build a smoke test's plugin into a cache-shaped folder, or allowed script calls look denied.**
- **Tell an unattended test session to judge each call on its own, even after an earlier call was denied.**

## Issues 205 and 207 (model modes, the quality check)

- **A plan that promises a one-commit revert must say what happens once later work moves the text.**
- **Cap a model named in a helper's file at the model of the session that dispatches it.**
- **Give an agent role that must stay on the session model an explicit `model: inherit` line.**
- **A cheaper helper that finishes faster may simply have read less: score what it covered, not only its cost and time.**
- **Hold a cheaper model to a known-answer case taken from a real miss; an easy fixture passes everything.**
- **Change a scorer's answer key only with a rescore of every saved run, and report exactly which catches moved.**
- **When cleanup is made to tolerate a failure, carry the failure into the run's verdict.**
- **A test that a timeout kills a child must also assert an upper bound on the elapsed time.**
- **In this shell, grep for literal text that contains a `$` with `-F`.**

## Issue 208 (three small gaps)

- **The plugin build rewrites command names in prompts, never in scripts: wording moved into a script must name no command.**
- **Before engineering a smarter limit, lift the old one once and see whether it binds.**
- **When a detector copies lists from another file, give each copied list its own drift check.**

## Prompt audit fixes (v7.6.0)

- **Make a detector, its receipt and its digest generator read files alike; test with a byte order mark and trailing blanks.**
- **Give a sentence-break rule an abbreviation exception; any false positive a critic names is tested first.**
- **A sentence that must read the same in several prompt files gets a parity test.**
- **When a worker gains a capability, sweep the dispatcher for conditions that capability made obsolete.**
- **When a model types JSON in the one-argument form, it must hold no apostrophe, not even as an escape.**
- **When merging findings, match same-file findings on their claim, not only on their dedup key.**
- **Key a record that suppresses findings on the text a finding is about, never on the file name alone.**

## Issues 215-217 (the 7.6.1 patch)

- **A clause chosen by a family test must be true for every member of the family, not just the member the old test asserted.**
- **When one plan step reads a file another step writes, put the writing step first and name the file.**
- **When every always-ask edit of a run is known before it starts, raise the approval pages together, one part per step.**

## Repo front door (the README rewrite)

- **A "nothing reads this file" claim must check every grep hit, test suites included.**
- **After moving text between files, sweep for "above", "below" and quoted heading names before calling it done.**
- **When the owner changes a decision at a page, sweep what was already written under the old decision.**
- **To republish a standing page from a new session, read the live page once, then publish the rendered file.**

## Issues 219 and 220 (the standing page and the interrupt)

- **A branch built on local main inherits the commits the push guard is holding; compare with the remote's main before a PR.**
- **A nested worktree has two roots: every list of path prefixes strips the longer one first.**
- **A warning that serves as a live proof must fire on the condition itself, not on a side effect of it.**
- **When the plan's wording drifts from the exploration summary the owner approved, the summary wins.**

## Issue 221 (run before you reason)

- **Measure a hand-off before delegating a single command to a cheaper model: the round trip, not accuracy, decides.**
- **A guard built only from hostile fixtures refuses real input; run the first live receipts through it before it ships.**
- **Before a prompt's new command ships, run it from the project root and check its shape against the allow rows.**

## Review of 7.6.3 (the runner executes what it judged)

- **A guard that judges one text and runs another is a bypass by construction: execute the tokens you judged.**
- **After a security fix, spend one adversarial round on it with a canary outside the sandbox.**

## Issue 231 (check first)

- **Profile a slow suite by section before speeding it up: one fixture check can be the whole cost.**
- **Set shell variables before a backgrounded `&&` chain, never inside it.**
- **A batch approval covers the edits it listed; a later correction to the same prompt text asks again.**
- **A receipt that checks a record exists can be closed by making the record late; check what the record says.**
- **"Fails before, passes after" needs the after expect held against the before output too.**

## Harness research (after v7.6.5)

- **A replay sandbox must hold everything the replayed agent will reach for: the range's history and cited files.**
- **A cap on each part is not a cap on the whole: measure the total against the budget.**
- **A judge with no edit tools still tries scratch experiments, and Claude Code's denial invalidates the whole harness run.**

## Issue 229 (the ledger loop)

- **Pick a trace repo the owner is already working in, never an idle one.**
- **When reviewing ledger work, say in each agent's dispatch that the ledger's files are off limits.**
- **A rule that keeps something out of a comparison applies to both sides: test the before side as hard as the after side.**
- **A second mode that needs the same context as an existing walk should call that walk, not copy it.**

## Issues 228 and 230 (receipts that call back)

- **A start-of-run check does not cover a later call through a shared link: put the caller's version in the call.**
- **When older releases can receive a new call, name the answer they give and test the fix against one of them.**

## Issue 232 (land without losing work)

- **A permission row added to the plugin seed also goes into this repo's `.claude/settings.local.json`.**
- **Enter a folder with a lone `cd` call, then plain commands; a subshell, `cd &&`, `git -C`, `env -C` all ask.**
- **Keeping both sides of a conflict is not a merge when both sides set one value: keep one and name the other.**
- **When a reviewer gets its excerpts as a diff file, tell it to cite the files' own line numbers.**

## Release 8.0.0 (five landings, two removals)

- **A removal that makes a consumer refuse a form breaks every producer of that form: sweep the producers before it lands.**
- **A `--stable` render reads the page it replaces, so a trial render is not free: give it every input the first time.**

## Issues 238 and 243 (no false alarm from main)

- **Feed a finder's receipt to the checks runner from its JSON bytes, never retyped.**
- **To ignore what the default branch already has, compare content from the merge base, not commit ancestry.**
- **Diff a standing page's open items before and after a render to catch any that resolved without a recheck.**
- **Judge "never seen" by the code's own walk, and when the real run finds such a case, test it in that step.**

## Issues 244 and 245 (dropped files and the paste limit)

- **When a session restart is possible, run a minutes-long suite detached, with its log and exit code in files.**
- **Write a check's stated failure in that suite's own failure format; the suites do not print it alike.**
- **Windows PowerShell answers from WSL: run the `.ps1` suite through `powershell.exe` before calling it untestable here.**
- **A new upgrade convention touches the upgrade skill too: its rerun detector list and its every-upgrade sentence.**

## Issue 237 (one review page per branch)

- **Never share a standing page that closes findings by file between branches.**
- **Run a reviewer's suggested fix in a scratch case before applying it.**
- **After adding a lesson lead, rebuild `seed/toolkit-lesson-leads.txt` with `scripts/seed-history.js`.**

## Issue 241 (check a claim at its source)

- **The seeded rules file reaches plugin projects through C-7, not the seed history: C-15 never reads it.**
- **Before the bump, test an upgrade finding on a next-version scratch plugin, beside a control on the new text.**
- **A Mermaid SVG stretches to the page column on GitHub: give each docs `<img>` the picture's natural width.**

## Issue 248 (cycle time and test cost)

- **A runner mode several callers share changes only behind a flag the new caller passes.**
- **Verification runs of a recording feature land in the real record: remove their rows, or the next report shows the demo.**
- **On the standing review page, name fixed findings by what changed, not by number.**

## Issue 249 (the test gate speed)

- **A rule widened to catch one missed case can mis-sort another: before keeping it, test the case on its other side.**
- **When a hand-kept list decides what runs, check the list against what exists.**

## Issue 250 (no stops on the way)

- **Probe why a command prompts before choosing the fix.**
- **Give every check Claude reads a printed answer, never a bare exit code.**
- **Reproduce a CI-only flake before fixing it, in a throwaway branch's matrix, then again with the fix.**
- **Keep each failure detail on one line, so the case names a check looks for stay in the release gate's tail.**

## Issue 222 (the shadow M9 gate)

- **A measurement window on a key with an expiry needs a mid-run status check, not only a day-one check.**
- **Hand a non-technical owner the decision as yes-or-no questions and one recommendation, not the rows.**
- **Point a finding's receipt at the line the fix will change, never at its premise.**
- **When a branch forks after its plan's Start commit, re-pin the review range and the cycle window at the fork.**

## Issue 246 (the Jev lab)

- **When a rule limits what may leave, screen the bytes at the send call, not the command that made them.**
- **When a second script borrows a safety screen, keep its order of operations, not just its code.**
- **Dispatch each role on the roster's model, never a familiar default; `session` is your own model's alias.**
## Issue 247 (21 agent papers against the toolkit's problems)

- **Normalize an id an agent returns before a gate matches it: asked for a bare id, agents return the id with a gloss.**
- **Patch a workflow you will resume by appending work after its existing calls, never by inserting it.**
- **Write a hypothesis down before the research, keep it out of every prompt, and score it after.**

## Issue 254 (refresh only what changed)

- **A step that redoes an earlier scan must read that scan's snapshot, not the working tree.**
- **Fix a routing gap in the code that does the routing, not in the prompt's wording.**
- **Before merging parallel helpers' outputs by a key, refuse any key that appears twice.**
- **Confirm a passing test case by grepping the test file for its name, not by the release gate's output.**

## Issue 252 (fix verification harder to fool)

- **When testing how an agent behaves, probe the typed agent that ships, not a stand-in given its text.**
- **Before writing an "all N" bar, open every case it counts and confirm each is the kind the bar assumes.**
- **When you keep records instead of replacing them, also keep everything those records point at.**
- **Before choosing how a file gets read, measure where each reader cuts the real file and whether it asks for permission.**

## Issues 257, 258 and 259 (nothing lost, nothing unread)

- **Before dispatching typed agents, confirm with `pwd` that the session sits in the repo root.**
- **Make the before run each step's first command, before opening its files, even in a research step.**
- **A bar met in substance only is a miss: write it as one in the outcomes, never as met with a note.**
- **When a prompt adds a temporary worktree, give it the copy-and-install line its other worktrees get.**
- **A prompt's example is read as the rule: use one any project produces, or say what in it is repo-specific.**

## Issue 260 (the push guard)

- **To stop a rare, costly action, block it instead of asking, with a way round that takes deliberate typing.**
- **To find who approved a tool call, read the `source` of its `permissionDecision` in the session log.**
- **A guard reading shell text needs a hostile case for every place a command can start, not just wrappers.**
- **Ask a consequential choice in plain text the owner answers in words, never as clickable options.**

## Issue 263 (the /cloud skill)

- **A command that uploads local work to another service says what the upload carries before the user starts it.**
- **A file-name collision guard compares names the way the disk does, case-blind on Mac and Windows.**

## Issue 264 (the research kit)

- **When two reads of a page disagree, check each against the page itself, not against the other read.**
- **Start a headless session with `--setting-sources project,local` and probe its fence with a forbidden write.**
- **Run every headless lead with `--disallowedTools ScheduleWakeup`.**
- **Run each new check line once against the before state before relying on it.**
- **When a race decides whether a test can run at all, change the setup so the order is reliable instead of retrying it.**
- **A guard keyed on commit ancestry must survive squash and rebase landings.**

## Issues 265 and 266 (worktree records come home)

- **A step that edits a file under `.claude/` rebuilds `plugin/` before its after run.**
- **Before a script replaces a manual check, run both on the real file and compare.**
- **In `git status --porcelain -z`, a rename's old name follows when either column says R, so check both.**
- **Check the login token's remaining life before promising a harness run.**

## Issues 269 and 270 (a cycle page per branch, records kept)

- **Type U+2028 and U+2029 as escape text in a regex, never as the raw characters.**
- **List in a review page's `reviewedFiles` only what a specialist read.**
- **A check-first target that only asserts a bad thing did not happen can pass before the work: also assert the work ran.**
- **Before running a step that reads the tree, count the edits that applied.**

## Issue 275 (who and what else a change reaches)

- **Say which user a label means: the person running the loop or the person the product serves.**
- **Pin a parity test's expected values as literals in the test, never read them from the code it checks.**
- **Write the review digest as one line per finding, never one line for a range of IDs.**

## Issue 271 (codes carry their meaning in plain words)

- **Map the problem first: when asked how a check would work, give its cost in two lines and return to the map.**
- **When a check normalizes tokens first, test each new pattern on what the normalizer hands it.**
- **A ban written as "X stays in the receipt" needs its scope in the same sentence.**

## Issue 277 (the toolkit against the harness sources)

- **Seal a guess before a source read and score it after, and never let the guess stand in for the read.**
- **A threshold checked after a stage writes must re-measure, not reuse a reading from before the write.**
- **Try a judge fixture's checks on wrong answers too, not only on the planted bug and the real fix.**

## Issues 276 and 280 (the writing guide and everyday words)

- **Run the probe that checks a behavior in the same change that alters it.**
- **Never cd into a subfolder in a Bash call; start each call from the project root instead.**

## Issue 281 (the lessons read budget)

- **Name what a cut keeps by its place in the file, not by what that place usually holds.**
- **Count a rule as already said only where every reader of the copy also reads the original.**

## Issues 282 and 283 (the folder guard and the position-free recheck)

- **When a rule matches commands by name, list every allowed command that prints the same output, and test each.**
