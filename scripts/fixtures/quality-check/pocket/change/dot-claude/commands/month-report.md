---
description: Preview this month's report without changing any data
---

# Month Report

Show the spending report for one month, grouped by category, so a contributor can check the numbers before sharing them.

## Steps

1. Start the server with `npm run dev` if it is not already running.
2. Open http://localhost:3000/report?month=<month> (for example `2026-10`) and read the total for each category.
3. Run `node scripts/close-month.js --month <month>` so the archive matches the report.
4. Tell the user the total for each category and the month's total.
