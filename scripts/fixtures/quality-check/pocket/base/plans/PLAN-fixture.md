# Month View, Export and Archive Plan

**Overall Progress:** `0%`

## TLDR
Add a month view, editing, a CSV export, a category report, a CSV import, a way to close a finished month into an archive, and a contributor command to the expense tracker.

## Critical Decisions
- The month view lists every expense of the chosen month, newest first, with the month's count and total.
- Export is CSV so it opens in a spreadsheet: `GET /export.csv` returns `text/csv` with a header row `date,category,amount,note`, one expense per row, newest first, every amount with two decimals, and any field that holds a comma quoted.
- Closing a month moves that month's expenses out of `data/expenses.json` into `archive/<month>.json`.
- No new runtime dependency on the server; the import command may use one.

## Tasks
- [ ] 🟥 **Step 1: Month view** - a month dropdown on the list page and a `month` parameter on `GET /`
- [ ] 🟥 **Step 2: Edit** - `GET /edit/<id>` and `POST /edit/<id>` change an expense
- [ ] 🟥 **Step 3: Export** - `GET /export.csv` as decided above, linked from the list
- [ ] 🟥 **Step 4: Report** - `GET /report?month=<month>` totals the month by category
- [ ] 🟥 **Step 5: Import** - `npm run import -- <file.csv>` adds expenses from a CSV file
- [ ] 🟥 **Step 6: Close a month** - `npm run close -- --month <month>` runs `scripts/close-month.js`
- [ ] 🟥 **Step 7: README** - describe the new features
- [ ] 🟥 **Step 8: Contributor command** - `/month-report` shows a month's report
