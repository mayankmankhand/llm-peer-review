# Do-Not-Report List

A living list of finding categories that are **not worth flagging** in this project. It is the noise-control companion to the receipt rule in `finding-contract.md`: the receipt rule keeps unprovable findings out, this list keeps known-noisy *classes* out.

**This list ships nearly empty on purpose.** It is grown from real false alarms, never pre-filled with guesses. When a review surfaces a finding you decide was noise, add its category to your project's own list so future reviews skip it. Think of it as a `LESSONS.md` scoped to review noise.

**Your project's entries live in `.claude/toolkit/do-not-report.md`**, a file your project owns, in the entry format below. Every reviewer that reads this list reads that file right after it, and a project with no such file adds nothing. This file is the toolkit's, read-only in a project on the plugin, so the project file is the only place an entry can go; the Active entries below stay empty unless the same false alarm recurs across projects.

## How to use it

- Before reporting a finding, check it against this list. If it matches an active entry, drop it silently (do not report it, do not mention that you skipped it). The project file's size is a command, not a read (M16): `test -s .claude/toolkit/do-not-report.md && grep -cE '^- ' .claude/toolkit/do-not-report.md || echo 0` prints its entry count, and `0` means skip the matching step for it entirely (a finder without Bash reads the same count off the copy inlined below it).
- This list only *suppresses* noise. It never *lowers* a real severity. The Universal Anchors in `severity-anchors.md` always win: an exposed secret, injection, insecure auth, data-loss, or accessibility-blocking issue is reported even if a category here might otherwise match.
- Keep entries specific. A vague entry ("style stuff") suppresses real findings; a specific one ("trailing-whitespace-only changes in generated files") does not.

## Entry format

Each entry is one bullet: the category, then a short reason it is noise *in this project*.

```
- <category> - <why it is noise here>
```

## Active entries

<!--
  None yet. Add entries here as real false alarms appear, e.g.:
  - Denial-of-service / resource-exhaustion concerns in CLI scripts - this toolkit's scripts run locally on trusted input, not as a network service
  Leave this list empty until a real false alarm justifies an entry. Do not pre-populate.
-->

(none yet)
