# Index

**Use this when:** You want to rebuild the project's INDEX.md file (the auto-generated file tree).
**Don't use this when:** You're doing a full documentation pass - use `/document` instead, which regenerates INDEX.md as part of a broader update.

<procedure>

## Steps

1. Check if `.claude/scripts/generate-index.js` exists in the project
2. If the script exists, run `node .claude/scripts/generate-index.js` and report the result
3. If the script exits with an error, show the error output to the user and suggest checking that the project is a valid git repository with tracked files
4. If the script doesn't exist, check whether `node` is available:
   - If `node` is not found: tell the user "Node.js is required to generate the index. Install Node.js first."
   - If `node` is found but the script is missing: tell the user "The index generator script is missing. Run `setup.sh` to install the toolkit."

</procedure>
