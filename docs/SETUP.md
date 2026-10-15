# Setting Up a Brand New Computer

> **Prefer to have your AI agent install the toolkit for you?** See [AGENT-SETUP.md](../AGENT-SETUP.md). This page is for walking through every step yourself, starting from a computer with nothing installed.

The toolkit is a plugin for Claude Code. Pick your operating system below, then continue with "Both Platforms" at the end. Using Cursor, Codex, or another editor without Claude Code plugins? Install the same tools (everything except Claude Code), then follow the [copy-install](INSTALL.md#copy-install-for-other-editors-cursor-codex-and-any-editor-without-claude-code-plugins) instead of Steps 6 and 7.

## Windows

The plugin is tested on Linux under WSL (Windows Subsystem for Linux, a way to run a Linux terminal inside Windows); native Windows is untested ([why](INSTALL.md#requirements)). So on Windows, install WSL and do everything else inside it.

### Step 1: Install WSL

- Open **PowerShell as Administrator**
- Run:
  ```powershell
  wsl --install
  ```
- Restart your computer, then open **Ubuntu** from the Start menu. Every command from here on runs in that Ubuntu terminal.

> Already have WSL but no distro? Run `wsl --install -d Ubuntu`.

### Step 2: Install Node.js

Node.js (a runtime that lets your computer execute JavaScript outside a browser) runs the toolkit's helper scripts - HTML report rendering, the `/tk:index` codebase map, session startup - plus the debate scripts. The core commands need it even if you skip the debates.

- Follow the Linux instructions at [nodejs.org/en/download](https://nodejs.org/en/download). Use Node.js 22 or newer: from 7.3.1 the debate scripts' OpenAI library needs it
- Verify:
  ```bash
  node -v
  ```

### Step 3: Install GitHub CLI

GitHub CLI (a command-line tool for working with GitHub from your terminal) is needed for `/tk:create-issue` and for the pull requests `/tk:document` opens.

- Install it with the Linux instructions at [cli.github.com](https://cli.github.com)
- Log in:
  ```bash
  gh auth login
  ```

### Windows paths in WSL

When using WSL, Windows paths convert like this:

```
C:\Users\YourName\Projects\my-app  →  /mnt/c/Users/YourName/Projects/my-app
```

If your path has spaces, wrap it in quotes:

```
"/mnt/c/Users/Jane Doe/Projects/MyApp"
```

**Now skip to [Both Platforms](#both-platforms) below.**

---

## Mac

Mac has bash and git built in. No WSL needed.

### Step 1: Install Xcode Command Line Tools

Open Terminal (search "Terminal" in Spotlight) and run:
```bash
xcode-select --install
```
Click "Install" when prompted. This gives you `git` and other developer tools.

### Step 2: Install Homebrew

Homebrew is a package manager for Mac. Install it by running this in Terminal:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Follow the instructions it prints at the end (usually adding Homebrew to your PATH).

### Step 3: Install Node.js and GitHub CLI

```bash
brew install node gh
```

Then log in to GitHub CLI:
```bash
gh auth login
```
Follow the prompts - it opens a browser to authenticate.

**Now continue to [Both Platforms](#both-platforms) below.**

---

## Both Platforms

### Step 4: Install Claude Code

Run this in your terminal (Ubuntu on Windows, Terminal on Mac):

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Then open a new terminal window and run `claude --version`; a working install prints a version number. Claude Code needs a Pro, Max, Team, Enterprise, or Console account (the free claude.ai plan does not include it), and the first time you run `claude` it logs you in through your browser. Other ways to install, and fixes when the install fails, are in Anthropic's [Claude Code setup guide](https://code.claude.com/docs/en/setup).

### Step 5: Verify Your Setup

Check that everything installed correctly:

```bash
node -v
git --version
gh --version
claude --version
```

You should see version numbers for each, and Node.js should be 22 or newer. If any command says "not found", go back to the relevant install step above. Using another editor instead of Claude Code? Skip the last check.

### Step 6: Install the toolkit plugin

Start Claude Code from any folder by typing `claude`, then type these two commands inside it:

```
/plugin marketplace add mayankmankhand/llm-peer-review
/plugin install tk@llm-peer-review
```

Restart Claude Code (type `/exit`, then `claude` again). The toolkit's commands now start with `tk:`, such as `/tk:explore`.

### Step 7: Set up your project

Go to your project's folder and start Claude Code there:

```bash
cd ~/Projects/my-app
claude
```

Then type `/tk:setup`. It writes a short rules file and a few starter files; nothing else lands in your project, and your own files are never overwritten. You are set up: type `/tk:explore` with an idea to start your first cycle, or follow the five-minute [demo script](DEMO-SCRIPT.md).

### Step 8 (Optional): API keys for the debates

You only need these for `/tk:ask-gpt` and `/tk:ask-gemini`. Both services have free tiers.

- **OpenAI key:** Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → create a key → copy it
- **Gemini key:** Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → create a key → copy it

Put them in `~/.claude/plugins/.env.local`, one file for every project on this computer:

```
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=AIza-your-key-here
```

A project's own `.env.local`, or an environment variable, works too. The design workflow's video generation takes an optional `FAL_KEY`; leave it out and the workflow hands you the prompt to run elsewhere. Every option is in [API-KEYS.md](../API-KEYS.md).

### Step 9 (Optional): The browser for `/tk:review-browser`

`/tk:review-browser` drives Chromium, the open-source browser engine, in the background. The plugin brings its own Node packages, so only the browser itself is left to install:

```bash
npx --prefix ~/.claude/plugins/data/tk-llm-peer-review/current playwright-core install chromium
```

On WSL or Linux, also install the system libraries Chromium depends on (this runs at the system level, so no `--prefix`):

```bash
sudo npx playwright-core install-deps chromium
```

Skip this step if you only want the core workflow; every other command works without it.
