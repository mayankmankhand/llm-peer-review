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

## License

MIT - see [LICENSE](LICENSE).
