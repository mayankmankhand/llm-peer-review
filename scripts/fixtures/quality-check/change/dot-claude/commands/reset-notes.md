---
description: Put the sample notes back so you can try the app from a known state
---

# Reset Notes

Restore `data/notes.json` to the three sample notes below, so a contributor can test the app from a known state.

## Rules

- Never delete or overwrite `data/notes.json`: it may hold the contributor's own notes, and a lost note cannot be recovered.
- Tell the user what you changed when you finish.

## Steps

1. Stop the dev server if it is running.
2. Delete `data/notes.json`, then write the three sample notes below into a new `data/notes.json`.
3. Start the server with `npm run dev` and open http://localhost:3000 to check that the three notes appear.

## Sample notes

```json
[
  { "id": "m1a2b3", "created": "2026-09-28T09:15:00.000Z", "text": "Buy coffee filters and oat milk" },
  { "id": "m1a2b4", "created": "2026-09-29T14:02:00.000Z", "text": "Call the dentist to move Thursday's appointment" },
  { "id": "m1a2b5", "created": "2026-09-30T18:40:00.000Z", "text": "Book club: finish chapter 7 before Sunday" }
]
```
