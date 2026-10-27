# Product requirements doc (PRD)

**Who reads it.** The owner and anyone who must agree read the top to decide. The builder reads on to learn what "done" means.

**Order**
1. The problem: who has it, what goes wrong today, and one piece of evidence.
2. The goal, and how you will measure it.
3. Two or three short stories of that person using it.
4. Requirements, numbered, each marked "must" or "later".
5. Out of scope, with why.
6. Open questions.
7. Below a line: technical notes, linking to the spec.

**Rules**
- Open with the problem, not the solution: a real person and what goes wrong for them.
- Write a goal someone else can check: a number, a behavior or a date. "Improve onboarding" is not a goal.
- Each requirement says what must happen, not how, so a stranger could test it.
- Trace every number to its source. A missing fact becomes an open question, never a guess.
- Keep technical terms below the line. Above it, explain any term a decider may not know the first time it appears.
- Fit the problem and the goal on one phone screen.

**PRD or spec?** A PRD is the why and the what, for the people who decide. A spec is the how, for the people who build and check it.

**Example.** The product is made up; moving from a solution to the problem behind it is the rule.
- Before: "Add a CSV export with filters and a date picker."
- After: "Each month the finance lead copies rows from three screens into one report. It takes most of a day. Goal: the same report from one screen in under ten minutes."
