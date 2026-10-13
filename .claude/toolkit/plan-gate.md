# Plan gate: old against new when a plan rewrites a review prompt

A rewritten review prompt can lose a catch while every check still passes: the suites ask whether the review still runs, never whether it still finds what it found. So when a plan's Critical Decisions say it rewrites or replaces a review prompt (a finder agent, a criteria file, `review.md`, the dispatch format or the finding contract), its Verify step adds this old-against-new check (M17) on the planted-bug fixture:

1. **Budget first.** Before the first run, the owner approves a total for these runs, recorded in `reports/quality-check/budget.json`; `node scripts/quality-check.js --budget` shows what is spent against it, and only the owner's word records a new total (`--approve <usd>`). No approved room means no run.
2. **Two runs of each build.** `node scripts/quality-check.js --role review --arm ship --build <the plan's start commit>` twice, then the same command with `--build HEAD` twice. Each run lands in `reports/quality-check/<stamp>-review-ship-<build>/`.
3. **Score new against old.** `node scripts/quality-check.js --score <new run>,<new run> --against <old run>,<old run>`. A planted bug that every old run caught and a new run missed is a finding for the plan's must-check list, written as one plan line so `/review` audits it like any other: `- [plan] Verification: <the bug> was caught by every old run and missed by a new one - scores: <the score file's path>`.

An edit to a review prompt that is not a rewrite (a sentence fixed, a rule added beside the others) needs only its must and must-not lines (M17), not these runs.
