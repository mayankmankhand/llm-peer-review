# nb-srv

Zero-dep flat-file note store: substring FTS over the in-memory set, bulk egress at `/api/export`, rotation into `backups/`.

## Getting started

1. Install Node.js 18 or newer.
2. In this folder, run `npm run dev`.
3. Open http://localhost:3000 in your browser and write your first note.

## Where your notes live

Each note is saved to `data/notes.json` as soon as you press Add. Run `npm run backup` to copy it into `backups/` (the newest 7 copies are kept), and `npm run import -- <file.csv>` to add notes from a spreadsheet.
