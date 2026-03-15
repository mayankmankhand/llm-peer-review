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

## Output Format

<output_format>

### Verdict Summary

| Finding | Status | Severity | Notes |
|---------|--------|----------|-------|
| R1 - [short description] | Confirmed / Dismissed | High / Medium / Low | [one-liner] |
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

Prioritized list of confirmed findings to fix, ordered by severity.

</output_format>
