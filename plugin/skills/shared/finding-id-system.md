# Finding ID System

Every finding gets a unique ID: **R1**, **R2**, **R3**, etc.

## Rules

1. **Sequential numbering** - Findings are numbered in the order they appear: R1, R2, R3, and so on.
2. **User references** - The user refers to findings by ID ("why did R2 survive?", or "fix R2 and R5" after a report-only run). IDs must be stable within a single review report.
3. **Sub-agent renumbering** - When combining results from several sub-agents, the merge helper (`merge-findings.js`) merges the lines that share a key and numbers the result into a single R1, R2, R3 sequence. No duplicates, no gaps.
4. **Cross-review independence** - IDs reset for each new review run. R1 in one review is unrelated to R1 in another.
