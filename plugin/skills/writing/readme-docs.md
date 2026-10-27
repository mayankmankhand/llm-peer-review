# README and docs

**Who reads it.** A newcomer who arrived from a link and is deciding whether this is for them, and a returning user looking one thing up. Neither knows the project's inside names.

**Order (a README)**
1. What it is and who it is for, in one or two sentences.
2. A short example of it in use, before any feature list.
3. Getting started: prerequisites, then numbered steps, ending in a result the reader can see.
4. Where things live, and how to get help.

**Order (a docs page).** One task per page: what it achieves, prerequisites, numbered steps, a checked result, then what to do when it goes wrong.

**Rules**
- The first screen passes a stranger test: no inside names, codes or abbreviations a newcomer would not know.
- Use exact names for commands, files and settings, spelled as in the code and in code formatting, so they can be copied.
- Run every command you document where you can, and say what the reader should see.
- Keep each warning or condition next to the step it belongs to.
- Link to the one place a fact lives instead of repeating it.
- Keep a README short: move reference detail into docs and link to it.

**Example.** The app is made up; leading with what the reader gets is the rule.
- Before: "Notekit is a modular, extensible note management framework with pluggable storage backends."
- After: "Notekit keeps your notes in one file on your computer and finds them again by any word in them. Install it, run `notekit add "first note"`, then search with `notekit find first`."
