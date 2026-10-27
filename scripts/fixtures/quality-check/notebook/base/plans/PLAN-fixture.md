# Search, Export and Backups Plan

**Overall Progress:** `100%`

## TLDR
Add search, a CSV export, a clear-all button, backups, a CSV import and a contributor command to the notes app, and serve every file in `public/` without a route per file.

## Critical Decisions
- Search runs on the server: `GET /api/notes?q=<text>` returns the notes whose text contains the query anywhere, ignoring case, newest first.
- Export is CSV, not JSON, so it opens in a spreadsheet: `GET /api/export` returns `text/csv` with a header row `id,created,text`, one note per row, newest first, and quotes any field that holds a comma.
- Backups are plain copies of `data/notes.json` in `backups/`, keeping the newest 7.
- No new runtime dependency on the server; the import script may use one.

## Tasks
- [x] 🟩 **Step 1: Search** - a search box on the page and a `q` parameter on `GET /api/notes`
- [x] 🟩 **Step 2: Export** - `GET /api/export` as decided above, linked from the page
- [x] 🟩 **Step 3: Clear all** - a button that removes every note
- [x] 🟩 **Step 4: Static files** - serve any file under `public/`
- [x] 🟩 **Step 5: Backups** - `npm run backup` runs `scripts/rotate-backups.sh`
- [x] 🟩 **Step 6: Import** - `npm run import -- <file.csv>` adds notes from a CSV file
- [x] 🟩 **Step 7: README** - describe the new features
- [x] 🟩 **Step 8: Contributor command** - `/reset-notes` restores the sample notes
