# Contributing

Thanks for your interest in LLM Peer Review! Contributions are welcome.

## Using This for Your Own Workflow

Fork the repo and adapt it to your project. The README has [setup instructions](README.md#add-to-a-new-project) for copying commands into any project.

## How to Contribute

- **Found a bug or have a suggestion?** Open an [issue](../../issues).
- **Want to fix a bug?** Submit a PR.
- **Bigger changes (new commands, architecture changes)?** Open an issue first so we can discuss the approach before you put in the work.

## Adapting Commands for Other Stacks

The commands in `.claude/commands/` are written with JS/TS projects in mind, but they're just markdown files — you can edit them for any stack. For example, `/review` checks for things like "no `any` types" and "proper TypeScript interfaces." If you're working in Python, swap those for your own conventions (type hints, docstrings, etc.).

## License

MIT — see [LICENSE](LICENSE).
