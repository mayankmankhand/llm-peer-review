# Cursor Slash Command Toolkit

**What this is:** A toolkit you drop into any coding project to give the AI a structured workflow. Instead of just asking AI to write code, you follow a process — explore, plan, build, review, get a second opinion. The slash commands enforce good habits and keep things organized.

**What this is not:** An app or a product. It's a set of instructions that live in your project folder. Once they're there, type `/` in your editor and the commands show up.

**This workflow is inspired by [Zevi's viral video on Lenny's Podcast](https://www.youtube.com/watch?v=1em64iUFt3U). The key difference is that Zevi manually conducts peer reviews by copying feedback from one model to another because he likes seeing the reasoning from tools like ChatGPT or Gemini. In my case, I don't always need that reasoning and didn't want to deal with the manual copy-paste. So I added two slash commands to automate the entire process.**

---

## Commands

| Command | What it does |
|---|---|
| `/explore` | Think through the problem before you touch code |
| `/create-plan` | Write a step-by-step plan with status tracking |
| `/execute` | Build it, updating the plan as you go |
| `/review` | Review code — reports issues only, won't fix until you say so |
| `/peer-review` | Evaluate feedback from other AI models |
| `/document` | Update your README and docs to match what was built |
| `/create-issue` | Create a GitHub issue (asks you questions first) |
| `/dev-lead-gpt` | Debate your code with ChatGPT (3 rounds) |
| `/dev-lead-gemini` | Debate your code with Gemini (3 rounds) |
| `/package-review` | Bundle your code into one file for external review |
| `/learning-opportunity` | Learn a concept at 3 levels of depth |

### The Workflow

Use them in this order:

```
/explore  →  /create-plan  →  /execute  →  /review  →  /peer-review  →  /document
```

You don't have to use every command every time. But following the order prevents the most common mistake: coding before you've thought it through.

---

## Setting Up a Brand New Computer

> **Never set up a dev environment before?** Follow the step-by-step guide in **[SETUP.md](SETUP.md)**. It covers Windows (WSL), Mac, Node.js, GitHub CLI, Cursor, and API keys — everything you need from scratch.

If you already have Node.js, git, and Cursor installed, skip ahead to [Add to a New Project](#add-to-a-new-project).

> **Not using Cursor?** The setup guide assumes Cursor, but the toolkit works with any editor that supports Claude Code. Copy the relevant setup page into any AI assistant and ask it to rewrite the steps for your editor.

---

## Add to a New Project

You have a project folder. You want the slash commands to work there. Three ways to do it:

### Option A: Install a Convenient Command (Easiest - Recommended)

Install a `setup-claude-toolkit` command you can run from anywhere:

**Bash (WSL, macOS, Linux):**
```bash
cd /path/to/llm-peer-review
bash scripts/install-alias.sh
source ~/.bashrc  # or ~/.zshrc for zsh
```

**PowerShell (native Windows):**
```powershell
cd C:\path\to\llm-peer-review
powershell -ExecutionPolicy Bypass -File scripts\install-alias.ps1
. $PROFILE  # Reload profile (or restart PowerShell)
```

> **Note:** If you don't have a PowerShell profile yet, the installer will create one for you automatically.

Then use it from anywhere:
```bash
# Specify target
setup-claude-toolkit /path/to/your-project

# Or from your project directory
cd /path/to/your-project
setup-claude-toolkit .
```

### Option B: Run a Setup Script Directly

Pick the script that matches your shell. You can run it in two ways:

**Method 1: Specify target (works from anywhere)**

**Bash (WSL, macOS, Linux):**
```bash
bash /path/to/llm-peer-review/scripts/setup.sh /path/to/your-project
```

**PowerShell (native Windows, no WSL):**
```powershell
powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup.ps1 -Target "C:\path\to\your-project"
```

**Method 2: Run from your project directory (no target needed)**

**Bash:**
```bash
cd /path/to/your-project
bash /path/to/llm-peer-review/scripts/setup.sh
```

**PowerShell:**
```powershell
cd C:\path\to\your-project
powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup.ps1
```

> **Note:** If you run the script from inside the toolkit repository without specifying a target, it will show an error to prevent accidentally copying files into the wrong place.

The scripts copy commands and scripts (warn before overwriting), skip CLAUDE.md and settings.local.json if they already exist — those are yours to customize. They also copy setup scripts into the target so you can use that project as a source later.

### Option C: Do It Manually

Copy these into your project:

| What to copy | Where it goes |
|---|---|
| `.claude/commands/` (whole folder) | `your-project/.claude/commands/` |
| `.claude/settings.local.json` | `your-project/.claude/settings.local.json` |
| `scripts/` (whole folder, including `setup.sh` and `setup.ps1`) | `your-project/scripts/` |
| `CLAUDE.md` | `your-project/CLAUDE.md` |
| `.env.local.example` | `your-project/.env.local.example` |

Then in your project folder:
```bash
npm install @google/generative-ai openai
cp .env.local.example .env.local
# Open .env.local and paste your API keys
```

> The `npm install` and `.env.local` steps are only needed if you want `/dev-lead-gpt` or `/dev-lead-gemini`. The other 9 commands work without them.

### Option D: Let Your AI Agent Do It

Tell your AI agent (Claude Code, Cursor, etc.): "Set up the workflow from this repo in my project" and point it to [`AGENT-SETUP.md`](AGENT-SETUP.md). It has step-by-step instructions written for AI agents.

---

## How Dev-Lead Commands Work

`/dev-lead-gpt` and `/dev-lead-gemini` run an automated debate between Claude and another AI about your code or plan. You don't have to copy anything manually — it handles the whole loop.

### Example

```
You: /dev-lead-gpt

Claude: What would you like me to review?
        1. Plan    2. Code    3. Branch    4. Feature    5. Other

You: Review the auth middleware

Claude: [Gathers context → sends to ChatGPT → they debate 3 rounds]

        --- Summary ---
        Agreed: Add token expiry check, extract magic numbers

        Recommended Actions:
        - [ ] Add token expiry validation
        - [ ] Move 3600 to TOKEN_EXPIRY_SECONDS

        Want me to implement these?

You: Yes
```

Want a different perspective? Run `/dev-lead-gemini` next.

---

## Customization

- **CLAUDE.md** — Tells the AI how to behave in your project. Edit it to match your style.
- **Commands** — Each file in `.claude/commands/` is independent. Want `/review` to check different things? Edit `review.md`.
- **Git workflow** — The git guidance in CLAUDE.md can be adjusted for your team.

---

## Troubleshooting

- **Commands don't show up in Cursor** — Make sure `.claude/commands/` exists in your project root with `.md` files inside. The editor workspace root must be the folder that contains `.claude/`.
- **`/dev-lead-gpt` or `/dev-lead-gemini` fails** — Check that `npm install` was run and `.env.local` has valid API keys.
- **"setup.sh: command not found"** — Run the full command from the setup instructions, not just `setup.sh` on its own.
- **"target directory does not exist"** — Create the project folder first: `mkdir -p /path/to/project`
- **Script errors with `/bin/bash^M` or "bad interpreter"** — This is a line-ending issue. Your shell scripts have Windows-style line endings (CRLF) instead of Unix-style (LF). Easiest fix: delete the folder and clone fresh. Advanced fix: run `git add --renormalize . && git checkout -- .` in the repo.
- **Setup one-liner fails partway through** — Safe to rerun the command. Leftover `/tmp/tmp.*` folders are harmless and can be deleted.

---

## License

MIT — see [LICENSE](LICENSE)
