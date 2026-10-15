# Contributing

Thanks for your interest in LLM Peer Review! Contributions are welcome.

## Using This for Your Own Workflow

Install the plugin ([setup instructions](docs/INSTALL.md#add-to-a-new-project)) and shape it to your project through the files your project owns, described below. To change the toolkit itself, fork the repo.

## How to Contribute

- **Found a bug or have a suggestion?** Open an [issue](https://github.com/mayankmankhand/llm-peer-review/issues).
- **Want to fix a bug?** Submit a PR.
- **Bigger changes (new commands, architecture changes)?** Open an issue first so we can discuss the approach before you put in the work.
- **Cutting a release?** The maintainer steps, the pre-push hook and the release gate are in [docs/RELEASING.md](docs/RELEASING.md).

## Adapting Commands for Other Stacks

The commands in `.claude/commands/` and skills in `.claude/skills/` are generic - they work with any language or stack. Commands are markdown files; skills use `SKILL.md` format with YAML frontmatter for agent discoverability. Review capabilities are skills so Claude can discover and invoke them automatically. On the plugin these files live inside the plugin and every update replaces them, so a project adds its own rules through the files in `.claude/toolkit/` instead (see [Extending a toolkit stage](docs/EXTENDING.md#extending-a-toolkit-stage)). For example, a review kind of your own in `review-kinds.md` can enforce type hints for Python or ban `any` types in TypeScript. In a fork of this repo you can edit the commands and skills themselves.

Shared reference files (`browse-api.md`, `conventions.md`, the eight `criteria-*.md`, `design-rules.md`, `dispatch-format.md`, `do-not-report.md`, `finding-contract.md`, `finding-id-system.md`, `hitl-loop.md`, `host-cli.md`, `html-look.md`, `html-outputs.md`, `html-render-debate.md`, `html-render-review.md`, `reading-budget.md`, `report-format.md`, `severity-anchors.md`) live in `.claude/skills/shared/` and are pulled into multiple skills via `` !`cat .claude/skills/shared/<file>` `` injection; `model-routing.md`, `toolkit-reference.md` and `design-profile-template.md` sit beside them and are read by path rather than injected. The prebuilt HTML shells in `.claude/skills/shared/shells/` (one per artifact type, plus `tokens.css`) are consumed by `.claude/scripts/render-html.js` rather than injected into prompts. If you edit a review skill, check whether the section you are changing comes from a shared file - editing the shared file updates every skill that uses it. If you change the visual look, update `tokens.css` and `html-look.md` together (they mirror each other).

If you are arriving with your own commands or an existing workflow rather than adapting the toolkit's, see [Already Have Your Own Workflow?](docs/EXTENDING.md#already-have-your-own-workflow) in the extending guide. It covers adding the auto loop to a workflow you already have, and which filenames the installer reclaims on upgrade.

## Changing a Diagram (Maintainer)

The pictures in the docs are SVG files rendered from Mermaid sources. Edit `docs/diagrams/<name>.mmd`, then run `node scripts/render-diagrams.js <name>` (add `--preview` for a page of the result at `artifacts/html/diagrams-preview.html`) and commit the source and both images together. The first run downloads a pinned Mermaid into the gitignored `scripts/.cache/`; it also needs Chromium (`npx --prefix .claude/scripts playwright-core install chromium`). `npm test` fails on an image older than its source, so a forgotten render shows up there. Colors come from `.claude/skills/shared/shells/tokens.css`; each `<img>` in the docs carries the picture's natural width so GitHub does not stretch it.

## Checking `/audit-html` (Maintainer)

After changing `/audit-html` or `.claude/skills/shared/html-own-files.md`, run the skill against this repository:

- It should flag long human-read files like `LESSONS.md` and `CHANGELOG.md` against its signals, then **veto them both** (LESSONS is Claude-read; CHANGELOG is host-native, rendered by GitHub and GitLab alike).
- It should veto `CLAUDE.md`, `CODEBASE_MAP.md`, anything in `.claude/`, and `PLAN-*.md`.
- For a downstream project, it should flag a status-board file in the project root and pass it through when no veto applies.

If it does not, the signals or vetoes are misaligned with `html-own-files.md`: fix that file, the single source of truth, not the skill.

## License

MIT - see [LICENSE](LICENSE).
