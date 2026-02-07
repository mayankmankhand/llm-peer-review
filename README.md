# Cursor Slash Command Toolkit

**What this is:** A toolkit you drop into any coding project to give the AI a structured workflow. Instead of just asking AI to write code, you follow a process — explore, plan, build, review, get a second opinion. The slash commands enforce good habits and keep things organized.

**What this is not:** An app or a product. It's a set of instructions that live in your project folder. Once they're there, type `/` in your editor and the commands show up.

**This workflow is inspired by [Zevi's viral video on Lenny's Podcast](https://www.youtube.com/watch?v=1em64iUFt3U). The key difference is that Zevi manually conducts peer reviews by copying feedback from one model to another because he likes seeing the reasoning from tools like ChatGPT or Gemini. In my case, I don't always need that reasoning and didn't want to deal with the manual copy-paste. So I added two slash commands to automate the entire process.**

---

## Already set up? → [Skip to: Add to a New Project](#add-to-a-new-project)

---

## Setting Up a Brand New Computer

Pick your operating system below, then continue with "Both Platforms" at the end.

### Windows

#### Step 1: Install WSL

WSL (Windows Subsystem for Linux) lets you run a Linux terminal on Windows. The scripts in this toolkit need it.

- Open **PowerShell as Administrator** (right-click Start menu → PowerShell → Run as administrator)
- Run:
  ```powershell
  wsl --install
  ```
- Restart your computer
- After restart you'll be asked to create a username and password for Linux — write these down

> **Already have WSL but no Linux distribution?** Run `wsl --install -d Ubuntu` in PowerShell as Administrator, then restart.

#### Step 2: Install Node.js

Node.js runs the dev-lead scripts (the ChatGPT/Gemini debate features). Install it inside your WSL terminal.

- Open your WSL terminal (search "Ubuntu" in the Windows Start menu)
- Run these commands one at a time:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  source ~/.bashrc
  nvm install 22
  nvm alias default 22
  ```

#### Step 3: Install GitHub CLI

Needed for the `/create-issue` command.

- In your WSL terminal:
  ```bash
  sudo apt update && sudo apt install -y gh
  ```
- Log in:
  ```bash
  gh auth login
  ```
  Follow the prompts — it opens a browser to authenticate.

#### Step 4: Install Cursor

- Go to [cursor.com](https://www.cursor.com) and download the Windows installer
- Install it normally — it's a desktop app on Windows but can open folders inside WSL

#### Windows paths in WSL

When using WSL, your Windows files are accessible but the path format changes:

```
C:\Users\YourName\Projects\my-app  →  /mnt/c/Users/YourName/Projects/my-app
```

Replace backslashes with forward slashes and replace `C:\` with `/mnt/c/`. If your path has spaces, wrap it in quotes:

```
"/mnt/c/Users/Jane Doe/Projects/MyApp"
```

**Now skip to [Both Platforms](#both-platforms) below.**

---

### Mac

Mac has bash and git built in. No WSL needed.

#### Step 1: Install Xcode Command Line Tools

Open Terminal (search "Terminal" in Spotlight) and run:
```bash
xcode-select --install
```
Click "Install" when prompted. This gives you `git` and other developer tools.

#### Step 2: Install Homebrew

Homebrew is a package manager for Mac. Install it by running this in Terminal:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Follow the instructions it prints at the end (usually adding Homebrew to your PATH).

#### Step 3: Install Node.js and GitHub CLI

```bash
brew install node gh
```

Then log in to GitHub CLI:
```bash
gh auth login
```
Follow the prompts — it opens a browser to authenticate.

#### Step 4: Install Cursor

- Go to [cursor.com](https://www.cursor.com) and download the Mac installer
- Drag it to your Applications folder

**Now continue to [Both Platforms](#both-platforms) below.**

---

### Both Platforms

#### Step 5: Verify Your Setup

Before going further, check that everything installed correctly. Run these in your terminal (Ubuntu/WSL on Windows, Terminal on Mac):

```bash
node -v
git --version
gh --version
```

You should see version numbers for each. If any command says "not found", go back to the relevant install step above.

#### Step 6: Get API Keys (Optional)

You only need these if you want `/dev-lead-gpt` and `/dev-lead-gemini`. Both services have free tiers.

- **OpenAI key:** Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → create a key → copy it
- **Gemini key:** Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → create a key → copy it

Save these somewhere safe. You'll paste them in Step 8.

#### Step 7: Clone This Repo

Run this in your terminal (Ubuntu/WSL on Windows, Terminal on Mac):
```bash
git clone https://github.com/mayankmankhand/llm-peer-review.git
cd llm-peer-review
npm install
```

#### Step 8: Set Up API Keys

```bash
cp .env.local.example .env.local
```

Open `.env.local` and paste in your keys from Step 6:
```
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=AIza-your-key-here
```

#### Step 9: Open in Cursor and Test

- Open Cursor → File → Open Folder
- Navigate to your `llm-peer-review` folder:
  - **Windows (WSL):** `\\wsl.localhost\Ubuntu\home\your-username\llm-peer-review`
  - **Mac:** `/Users/your-username/llm-peer-review`
- Type `/explore` to test your first command

You're set up. Read the next section to use this toolkit in your actual projects.

---

## Add to a New Project

You have a project folder. You want the slash commands to work there. Three ways to do it:

### Option A: Run the Setup Script (Recommended)

Open your terminal (Ubuntu/WSL on Windows, Terminal on Mac) and run:
```bash
bash /path/to/llm-peer-review/scripts/setup.sh /path/to/your-project
```

Example:
```bash
bash ~/llm-peer-review/scripts/setup.sh ~/Projects/my-app
```

The script copies commands and scripts (warns before overwriting), skips CLAUDE.md and settings.local.json if they already exist — those are yours to customize. It also copies itself into the target, so you can use that project as a source later.

### Option B: Do It Manually

Copy these into your project:

| What to copy | Where it goes |
|---|---|
| `.claude/commands/` (whole folder) | `your-project/.claude/commands/` |
| `.claude/settings.local.json` | `your-project/.claude/settings.local.json` |
| `scripts/` (whole folder) | `your-project/scripts/` |
| `CLAUDE.md` | `your-project/CLAUDE.md` |
| `.env.local.example` | `your-project/.env.local.example` |

Then in your project folder:
```bash
npm install @google/generative-ai openai
cp .env.local.example .env.local
# Open .env.local and paste your API keys
```

> The `npm install` and `.env.local` steps are only needed if you want `/dev-lead-gpt` or `/dev-lead-gemini`. The other 9 commands work without them.

### Option C: Let Your AI Agent Do It

Tell your AI agent (Claude Code, Cursor, etc.): "Set up the workflow from this repo in my project" and point it to [`AGENT-SETUP.md`](AGENT-SETUP.md). It has step-by-step instructions written for AI agents.

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
