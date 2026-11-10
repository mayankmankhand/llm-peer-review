# Changelog

<!-- The "What's new since v4.3.3" rollup lives at the BOTTOM of this file. When cutting a release, add the new "## vX.Y.Z" section right below this comment and extend that rollup paragraph with one sentence for the new version. -->

## Unreleased

<!-- At release: run scripts/seed-history.js (seed/settings.local.json changed); criteria-browser.md is on the catch-rate list, so two measured runs or the override; re-record the prompt-load baseline after the approved prompt edits (e80fc48). -->

**A fix can no longer pass the check its own session wrote, review pages hide more secrets, and 24 things that could break another project are fixed.** A research report from 2 November was checked against the toolkit with five measured tests, and three of them changed how a review checks its fixes. A sort of 36 suspected breaks, each tried in a project unlike this one, kept 24, and all 24 are fixed here.

### Fixed

- **Reviews.** `/tk:review-full` no longer erases open findings it never looked at: it names the rows it ran, so the review page carries every other open finding forward, and a finding with no file closes when its row runs again and does not raise it. The plan you chose reaches the plan reviewer. The code and security reviewers' file searches match real files, and a directly typed review has a range to search. A small `/tk:review` that skips the reviewer fan-out still loads the rules it depends on and saves its proofs under the names the scripts look for. The example proof in the finding rules now aims at what a fix changes, not at a word the fix keeps.
- **`/tk:document`.** It no longer removes the side copy of the project before it finishes, and no longer pushes a branch that was meant to stay on your machine. A failed read of your corrections no longer marks those messages as read, and a brand-new repository gets its doc checks.
- **`/tk:execute`.** An older plan with no check lines that reaches 100% now says why it stops before review and what to type, instead of failing a check it never explains.
- **`/tk:merge`.** The PR text survives after the side copy is gone. On a project that lands through GitHub or GitLab, it reads the host's fresh copy of main. Creating a PR names your default branch instead of assuming `main`. A remote that names neither GitHub nor GitLab, with both command-line tools installed, no longer stops with no way through: your answer passes to the script.
- **Pages.** A page published in an earlier session can be updated instead of going stale.
- **Browser checks.** Auto-start tests the server your session names before the common ports, so it no longer tests another project's app that happens to answer. A session whose output is too long to show whole still shows its page, its console and network errors and the reason a step failed first.
- **Design.** Undoing a design round that lost its comparison no longer stops to ask (see Upgrading).
- **`/tk:audit-html`** finds scripts that merely contain the word it searches for, async and `.mjs` generators, and file names with spaces or accents.
- **The correction log** reads each correction's stage from the session instead of guessing it from one exchange, so its counts per stage no longer invent `execute` runs.

### Changed

- **Review pages hide more secrets.** The proof under each finding is masked with all 15 of the push guard's secret patterns (it had fallen to 8). The command a check ran is masked as well as its output, every line of a private key goes (a key on one line and a PGP block too), and so does any value after a name with a secret-sounding word (pass, password, pwd, secret, token, a name ending in `_key`, credentials, cookie), quoted or not. Still shown: a value with a dot and no digit, one that starts with `$` or `<` or holds a bracket (these read as code), a name with no secret-sounding word, and values under 8 characters. The page stays private until you share it.
- **A fix's own session can no longer settle the check that judges it.** The review keeps each recheck it writes. A recheck that was rewritten proves nothing, so the kept one runs again, and if that fails, one fresh reviewer judges the fix. A recheck whose expected result the fixing session filled in is held to its first run, and a pass on it goes to a fresh reviewer too. That extra look spends no fix round and happens once per round.
- **A true finding survives when another bug hides it.** The double-check no longer refutes a real finding only because a different defect stops its code from running today: it stands, with a note naming the hiding bug, and the note goes in the review summary.
- **The true part of a refuted finding becomes a finding.** When a double-checker refutes a finding but notes a part that is true, that part is now checked and fixed like any finding, once, instead of waiting in the summary. Direct reviews and the debates follow the same steps.

### Upgrading

- Everything arrives with the plugin update.
- Rerun `/tk:setup` to add one permission row, `Bash(git revert *)`, so undoing a lost design round does not stop to ask; `/tk:upgrade` lists it as missing until you do (C-9, the check that your permission rows match the shipped starter settings).
- A copy-install for other editors gets these when you re-run `setup.sh` or `setup.ps1`.

### Why

The 2 November report proposed ideas for the loop, and measured tests decided what was built. Replaying 14 saved fix rounds found 2 FIXED verdicts on problems that were still there, each resting on a recheck the fixing session rewrote or filled in. The double-check refuted true findings that another bug hid in 3 of 5 runs, and in none of 5 with the new sentence, while a planted false finding was still refuted 26 of 26 times. Of 20 notes the double-check had left about true parts, 5 stood on a fresh proof, and the owner would fix all 5. A recovery notice for sessions that Claude Code compresses failed its test and was not built; the fallback is #293. The review of this work raised 44 findings and fixed the 16 that survived its double-check.

## v8.0.17 - Landings That Finish, Notes That Catch Up (2026-11-04)

**Landings stop less and check more, and older projects get their unread release notes once (#284, #285, #286).** A landing from a worktree no longer stops at its own push. A landing that combined a conflict in `CLAUDE.md` or one of your add-on instruction files waits for your yes, and your own fix rules that name a landing now apply to it. A project first upgraded before 8.0.6 gets a one-time offer to check its own files against the earlier release notes it never read.
