# Contributing

Thanks for your interest in LLM Peer Review! Contributions are welcome.

## Using This for Your Own Workflow

Fork the repo and adapt it to your project. The README has [setup instructions](README.md#add-to-a-new-project) for copying commands into any project.

## How to Contribute

- **Found a bug or have a suggestion?** Open an [issue](../../issues).
- **Want to fix a bug?** Submit a PR.
- **Bigger changes (new commands, architecture changes)?** Open an issue first so we can discuss the approach before you put in the work.

## Adapting Commands for Other Stacks

The commands in `.claude/commands/` and skills in `.claude/skills/` are generic - they work with any language or stack. Commands are markdown files; skills use `SKILL.md` format with YAML frontmatter for agent discoverability. Review capabilities are now skills so Claude can discover and invoke them automatically. You can customize any of them for your project. For example, you could add project-specific checks to `/review-code` like "enforce type hints" for Python or "no `any` types" for TypeScript.

Shared reference files (currently `browse-api.md`, `finding-id-system.md`, `output-template.md`, `severity-anchors.md`) live in `.claude/skills/shared/` and are pulled into multiple skills via `` !`cat .claude/skills/shared/<file>` `` injection. If you edit a review skill, check whether the section you are changing comes from a shared file - editing the shared file updates every skill that uses it.

## Releasing (Maintainer)

To bump the toolkit version:

    bash scripts/setup/bump-version.sh <new-version>

The script updates VERSION, package.json, package-lock.json (if present), and the `.claude/rules/toolkit.md` version stamp. Then manually:

- Add a new section to CHANGELOG.md
- Update AGENT-SETUP.md title and "What's new" block (rename the previous block to "What was new in vX.Y")
- If this release bumps a default model, follow the model-bump reminder printed by `bump-version.sh`: append the OLD `DEFAULT_*_MODEL` value to `KNOWN_STALE_*_MODELS` FIRST, then update `DEFAULT_*_MODEL` to the new value, then update `.env.local.example` and `API-KEYS.md`
- Commit, push, tag
- Cut a GitHub release with `gh release create vX.Y.Z` so the latest release on GitHub reflects current main

## License

MIT - see [LICENSE](LICENSE).
