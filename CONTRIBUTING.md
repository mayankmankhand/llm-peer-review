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

Shared reference files (`browse-api.md`, `do-not-report.md`, `finding-id-system.md`, `hitl-loop.md`, `host-cli.md`, `html-look.md`, `html-render-debate.md`, `html-render-review.md`, `model-routing.md`, `finding-contract.md`, `reading-budget.md`, `report-format.md`, `severity-anchors.md`) live in `.claude/skills/shared/` and are pulled into multiple skills via `` !`cat .claude/skills/shared/<file>` `` injection. The prebuilt HTML shells in `.claude/skills/shared/shells/` (one per artifact type, plus `tokens.css`) are consumed by `.claude/scripts/render-html.js` rather than injected into prompts. If you edit a review skill, check whether the section you are changing comes from a shared file - editing the shared file updates every skill that uses it. If you change the visual look, update `tokens.css` and `html-look.md` together (they mirror each other).

If you are arriving with your own commands or an existing workflow rather than adapting the toolkit's, see [Already Have Your Own Workflow?](README.md#already-have-your-own-workflow) in the README. It covers adding the auto loop to a workflow you already have, and which filenames the installer reclaims on upgrade.

## Releasing (Maintainer)

Users receive the plugin from a release tag, not from main: the `tk` entry in `.claude-plugin/marketplace.json` pins the tag `v<version>`, so nothing merged to main reaches anyone until a release tags it.

**Once per clone, install the pre-push hook:**

    bash scripts/setup/install-hooks.sh

It points this clone's git hooks at `scripts/git-hooks/`. Every push then runs the M11 tripwire, and a push to `main` or to a tag named `v` followed by a digit (the hook matches `refs/tags/v[0-9]*`, so `v7.1.0` counts and `vendor-snapshot` does not) also runs the release gate and is blocked when the gate fails. Undo with `git config --unset core.hooksPath`.

**The release gate** is `node scripts/release-check.js`. It runs every `scripts/test-*.js` suite, its own `scripts/test-release-check.js` included (only exit codes count; that test points the gate only at scratch repos, so it cannot recurse), checks that `plugin/` matches its source (`node scripts/build-plugin.js --check`), checks that the version in `plugin/.claude-plugin/plugin.json` went up if `plugin/` changed since the previous release tag, and checks that the marketplace entry is a `git-subdir` source on path `plugin` pinned to ref `v<version>`. Each check prints one `ok` or `FAIL` line with its reason.

**Release order:**

1. Bump the version: `bash scripts/setup/bump-version.sh <new-version>`. The script updates VERSION, package.json, package-lock.json (if present), and the version stamps in the three stamped files (the seeded `.claude/rules/toolkit.md`, `.claude/skills/shared/toolkit-reference.md`, `.claude/skills/shared/html-outputs.md`), then rebuilds `plugin/`.
2. In the same change, set the `tk` entry's `source` in `.claude-plugin/marketplace.json` to the full `git-subdir` object below, and do the manual steps below. Commit all of it as one release commit. The gate checks `source`, `path` and `ref` but not `url`, so copy `url` exactly: without it the entry passes the gate and still breaks every install once main is pushed.

   ```json
   "source": {
     "source": "git-subdir",
     "url": "mayankmankhand/llm-peer-review",
     "path": "plugin",
     "ref": "v<new-version>"
   }
   ```

3. Run `node scripts/release-check.js` until it is green.
4. Tag the release commit `v<new-version>` and push the tag. The hook runs the gate again, including the check that the tag matches the version in its commit's `plugin.json`.
5. Merge to main and push main.
6. Cut a GitHub release with `gh release create v<new-version>` so the latest release on GitHub matches the tag users install.

Manual steps for the release commit:

- Add a new section to CHANGELOG.md
- Update AGENT-SETUP.md title and "What's new" block (rename the previous block to "What was new in vX.Y", and keep only the last three blocks inline - older entries point at CHANGELOG.md)
- If this release bumps a default model, follow the model-bump reminder printed by `bump-version.sh`: append the OLD `DEFAULT_*_MODEL` value to `KNOWN_STALE_*_MODELS` FIRST, then update `DEFAULT_*_MODEL` to the new value, then update `.env.local.example` and `API-KEYS.md`
- If the installers changed since the last release, run `bash scripts/setup/test-installer-guarantees.sh` (and the `.ps1` mirror on Windows) before tagging; it is not a `scripts/test-*.js` suite, so the gate does not run it

## License

MIT - see [LICENSE](LICENSE).
