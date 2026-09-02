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

Shared reference files (`browse-api.md`, `do-not-report.md`, `finding-id-system.md`, `hitl-loop.md`, `host-cli.md`, `html-look.md`, `html-render-debate.md`, `html-render-review.md`, `model-routing.md`, `output-template.md`, `reading-budget.md`, `severity-anchors.md`) live in `.claude/skills/shared/` and are pulled into multiple skills via `` !`cat .claude/skills/shared/<file>` `` injection. The prebuilt HTML shells in `.claude/skills/shared/shells/` (one per artifact type, plus `tokens.css`) are consumed by `.claude/scripts/render-html.js` rather than injected into prompts. If you edit a review skill, check whether the section you are changing comes from a shared file - editing the shared file updates every skill that uses it. If you change the visual look, update `tokens.css` and `html-look.md` together (they mirror each other).

If you are arriving with your own commands or an existing workflow rather than adapting the toolkit's, see [Already Have Your Own Workflow?](README.md#already-have-your-own-workflow) in the README. It covers adding the auto loop to a workflow you already have, and which filenames the installer reclaims on upgrade.

## Releasing (Maintainer)

To bump the toolkit version:

    bash scripts/setup/bump-version.sh <new-version>

The script updates VERSION, package.json, package-lock.json (if present), and the version stamps in both managed rules files (`.claude/rules/toolkit.md`, `.claude/rules/html-outputs.md`). Then manually:

- Add a new section to CHANGELOG.md
- Update AGENT-SETUP.md title and "What's new" block (rename the previous block to "What was new in vX.Y", and keep only the last three blocks inline - older entries point at CHANGELOG.md)
- If this release bumps a default model, follow the model-bump reminder printed by `bump-version.sh`: append the OLD `DEFAULT_*_MODEL` value to `KNOWN_STALE_*_MODELS` FIRST, then update `DEFAULT_*_MODEL` to the new value, then update `.env.local.example` and `API-KEYS.md`
- If the installers changed since the last release, run `bash scripts/setup/test-installer-guarantees.sh` (and the `.ps1` mirror on Windows) before tagging
- If `.claude/scripts/gen-media.js` changed, run `node scripts/test-gen-media.js` (no network or key needed)
- Commit, push, tag
- Cut a GitHub release with `gh release create vX.Y.Z` so the latest release on GitHub reflects current main

## License

MIT - see [LICENSE](LICENSE).
