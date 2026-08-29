A different team lead within the company has reviewed the current code/implementation and provided findings below. Important context:

- **They have less context than you** on this project's history and decisions
- **You are the team lead** - don't accept findings at face value

**Use this when:** You have feedback from `/ask-gpt`, `/ask-gemini`, or another AI model and want to evaluate which findings are real.
**Don't use this when:** You want a first review (use `/review-code`), or you want to start a debate (use `/ask-gpt` or `/ask-gemini`).

Findings from peer review:

[PASTE FEEDBACK FROM OTHER MODEL]

---

## How to Evaluate

<procedure>

For EACH finding in the pasted feedback:

1. **Verify it exists** - Actually check the code. Does this issue really exist?
2. **If it doesn't exist** - Explain why (already handled, misunderstood the architecture, etc.)
3. **If it does exist** - Classify it:
   - **Confirmed - real problem** - The finding is accurate and needs fixing
   - **Confirmed - opinion, not a bug** - Valid observation but not wrong (style preference, alternative approach)
   - **Dismissed** - Incorrect, already handled, or based on missing context

</procedure>

Severity on every finding below follows the shared rubric, the same one the review skills read. It is not decoration: confirmed findings enter the auto loop's M2 audit, which routes a Block to three independent skeptics and a Warn or Suggest to one, and the Action Plan is ordered by it.

!`cat .claude/skills/shared/severity-anchors.md`

## Output Format

<output_format>

### Verdict Summary

| Finding | Status | Severity | Notes |
|---------|--------|----------|-------|
| R1 - [short description] | Confirmed / Dismissed | 🚫 Block / ⚠️ Warn / 💡 Suggest | [one-liner] |
| R2 - ... | ... | ... | ... |

### Confirmed Findings (real problems)

For each confirmed finding:
- **What:** one sentence
- **Why it matters:** impact if left unfixed
- **Fix direction:** suggested approach

### Dismissed Findings

For each dismissed finding:
- **What they said:** one sentence
- **Why it's wrong:** explain with evidence from the code

### Action Plan

Prioritized list of confirmed real problems, ordered by severity. This is the order the auto loop processes them in (see After the Evaluation below).

</output_format>

## After the Evaluation

The evaluation above is itself the audit step of the auto loop (M2's skeptical lens applied to external feedback); keep its evidence discipline exactly as described. The operating rules live in `.claude/skills/shared/hitl-loop.md` (rule IDs M1-M14). Once the verdicts are in:

- **Dismissed** findings go to the log with their evidence. They are never fixed.
- **Confirmed - opinion, not a bug** findings go to the digest as observations, not fixes.
- **Confirmed - real problem** findings enter the auto loop: fix them (the M7 and M9 gates still apply), then re-verify per M3, M5, and M6. Each exits as page (only per M1), digest with receipts (M8), or log.

Saying **"report only"** on this run keeps evaluate-and-wait behavior for that run (M10).
