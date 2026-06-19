# Do-Not-Report List

A living list of finding categories that are **not worth flagging** in this project. It is the noise-control companion to the receipt rule in the output template: the receipt rule keeps unprovable findings out, this list keeps known-noisy *classes* out.

**This list ships nearly empty on purpose.** It is grown from real false alarms, never pre-filled with guesses. When a review surfaces a finding you decide was noise, add its category here so future reviews skip it. Think of it as a `LESSONS.md` scoped to review noise.

## How to use it

- Before reporting a finding, check it against this list. If it matches an active entry, drop it silently (do not report it, do not mention that you skipped it).
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
