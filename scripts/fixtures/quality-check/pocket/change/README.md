# Pocket

A small web app for keeping track of what you spend. Every expense stays on your computer in one file, `data/expenses.json`.

## Closing a month

When a month is over, run `npm run close -- --month 2026-10` to move its expenses out of `data/expenses.json` and into `archive/2026-10.json`. A closed month no longer shows in the list.

## Months

The list shows one month at a time, newest expenses first, with the month's count and total. Pick another month from the dropdown at the top of the list.

## Editing

Each expense has an Edit link for fixing its date, category, amount or note.

## Export and report

Export CSV downloads every expense as a file a spreadsheet can open. Report totals the chosen month by category.

## Importing

Run `npm run import -- <file.csv>` to add expenses from a spreadsheet with the columns date, category, amount and note. A row whose date is not a real date, or whose note is already in the list, is skipped.

## Where your expenses live

Each expense is saved to `data/expenses.json` as soon as you press Add, and closed months are in `archive/`. Copy both to back up your expenses.

## Getting started

1. Install Node.js 18 or newer.
2. In this folder, run `npm run dev`.
3. Open http://localhost:3000 in your browser and add your first expense.
