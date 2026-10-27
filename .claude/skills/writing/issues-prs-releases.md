# Issues, pull requests and release notes

**Who reads it.** An issue: whoever triages or fixes it, often months later. A pull request: the reviewer, deciding whether it is safe to merge. Release notes: the people who use or install the project, deciding what to do when they update.

**Order**
- An issue: a summary in one or two sentences, what happens now, what should happen, and the evidence (what was seen, where, and how to see it again).
- A pull request: what changed and why, in plain sentences; how it was checked (commands and results); what the reviewer should look at; risks, and how to undo.
- Release notes: what changed for the reader, grouped as added, changed and fixed; the upgrade steps they must take, in order; credit where it is due.

**Rules**
- Title an issue or pull request by the problem or the change, not by the cause you suspect.
- State what was seen as fact, and a guessed cause as a guess.
- When the project has its own issue or pull request template, use it; this file only helps fill it in.
- In release notes, say what the reader will notice or must do, not which files moved. Give any code or inside name its meaning in plain words.
- Name the version and the date.
- Keep private details out of anything public: no secrets, and no names of people or projects that did not ask to be named.

**Example.** The release is made up; the reader's change first is the rule.
- Before: "Refactored storage layer; bumped schema to v3."
- After: "Notes now save even when two tabs are open at once. If you upgrade from 1.1, run `notekit migrate` once; it takes a few seconds."
