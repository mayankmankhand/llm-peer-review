# Finding ID System

Every finding gets a unique ID: **R1**, **R2**, **R3**, etc.

## Rules

1. **Sequential numbering** - Findings are numbered in the order they appear: R1, R2, R3, and so on.
2. **User references** - The user can say "fix R2 and R5" to approve specific fixes. IDs must be stable within a single review report.
3. **Sub-agent renumbering** - When combining results from sub-agents (e.g., parallel file reviews), renumber all findings into a single R1, R2, R3 sequence. No duplicates, no gaps.
4. **Cross-review independence** - IDs reset for each new review run. R1 in one review is unrelated to R1 in another.
