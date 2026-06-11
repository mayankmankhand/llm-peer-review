# Setting Up a Brand New Computer

> **Prefer to have your AI agent install the toolkit for you?** See [AGENT-SETUP.md](AGENT-SETUP.md). That is the recommended path. This page is the manual alternative for users who want to walk through every step themselves.

Pick your operating system below, then continue with "Both Platforms" at the end.

> **Windows users:** This toolkit runs on macOS, Linux, or WSL (Windows Subsystem for Linux, a way to run a Linux terminal inside Windows). We recommend **Option A (WSL + bash)** so every command works. Option B (native PowerShell) supports setup and most commands, but the debate commands (`/ask-gpt`, `/ask-gemini`) require bash/WSL.

## Windows

You can use this toolkit in **two ways** on Windows:

- **Option A (recommended): WSL + bash** for full functionality including AI debates
- **Option B: Native Windows PowerShell** using `scripts/setup/setup.ps1` (setup + non-debate commands only)

### Step 1: Install Node.js

Node.js (a runtime that lets your computer execute JavaScript outside a browser) runs the toolkit's helper scripts - HTML report rendering, the `/index` codebase map, session startup - plus the ask-gpt and ask-gemini debate scripts. The core commands need it even if you skip the debates.

- Install from [nodejs.org](https://nodejs.org) (LTS is the stable long-term version, which is fine), then reopen your terminal
- Verify:
  ```powershell
  node -v
  npm -v
  ```

### Step 2: Install GitHub CLI

GitHub CLI (a command-line tool for working with GitHub from your terminal) is needed for the `/create-issue` command.

- Install from [cli.github.com](https://cli.github.com)
- Log in:
  ```powershell
  gh auth login
  ```

### Step 3: Install Cursor

Cursor (an AI-powered code editor based on VS Code) is the app you will use to run the toolkit commands.

- Go to [cursor.com](https://www.cursor.com) and download the Windows installer
- Install it normally

### Step 4 (Optional): Install WSL if you prefer a bash workflow

WSL gives you a Linux terminal on Windows. Install it if you want bash-style commands and Linux file paths:

- Open **PowerShell as Administrator**
- Run:
  ```powershell
  wsl --install
  ```
- Restart your computer

> Already have WSL but no distro? Run `wsl --install -d Ubuntu`.

### Windows paths in WSL (only for Option A)

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

### Step 4: Install Cursor

Cursor (an AI-powered code editor based on VS Code) is the app you will use to run the toolkit commands.

- Go to [cursor.com](https://www.cursor.com) and download the Mac installer
- Drag it to your Applications folder

**Now continue to [Both Platforms](#both-platforms) below.**

---

## Both Platforms

### Step 5: Verify Your Setup

Before going further, check that everything installed correctly. Run these in your terminal (Ubuntu/WSL on Windows, Terminal on Mac):

```bash
node -v
git --version
gh --version
```

You should see version numbers for each. If any command says "not found", go back to the relevant install step above.

### Step 6: Install Optional Dependencies

> **Note:** Run these commands in your project folder after completing Steps 8-10 (clone + setup). They are listed here so you know what is available, but you need the project first.

All toolkit runtime packages live inside `.claude/scripts/` so they do not clutter your project's root `package.json` (the file Node uses to list a project's dependencies). One install in that folder enables every toolkit feature that needs Node packages:

```bash
npm install --prefix .claude/scripts
```

`npm` is Node's package installer. That command covers the Node packages for `/ask-gpt`, `/ask-gemini`, and `/review-browser`.

`/review-browser` needs one extra step: install Chromium (the open-source browser engine Playwright drives in the background).

```bash
npx --prefix .claude/scripts playwright-core install chromium
```

On WSL/Linux, also install the system libraries Chromium depends on (apt-based; this runs at the system level, so no `--prefix`):
```bash
sudo npx playwright-core install-deps chromium
```

Skip the install entirely if you just want the core workflow commands (`/explore`, `/create-plan`, `/execute`, `/review-code`, etc.) - they work without any npm dependencies.

**Check what's already installed:**
```bash
npm list --prefix .claude/scripts --depth=0              # toolkit runtime deps
npx --prefix .claude/scripts playwright-core --version   # Chromium binary
```

### Step 7: Get API Keys (Optional)

You only need these if you installed the debate dependencies above (`/ask-gpt` and `/ask-gemini`). Both services have free tiers.

- **OpenAI key:** Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → create a key → copy it
- **Gemini key:** Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → create a key → copy it

Save these somewhere safe. You'll paste them in Step 9.

### Step 8: Clone This Repo

This step installs the toolkit itself. You'll copy it into your actual projects later using the setup command.

Run this in your terminal (PowerShell or WSL on Windows, Terminal on Mac):
```bash
git clone https://github.com/mayankmankhand/llm-peer-review.git
```

> **Note:** You don't need to run `npm install` here. Dependencies are installed in your target project when you run setup later. Only run `npm install` in this folder if you want to test `/ask-gpt` or `/ask-gemini` inside the toolkit repo itself.

### Step 9: Set Up API Keys

```bash
cp .env.local.example .env.local
```

Open `.env.local` and paste in your keys from Step 7:
```
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=AIza-your-key-here
```

### Step 10: Open in Cursor and Test

- Open Cursor → File → Open Folder
- Navigate to your `llm-peer-review` folder:
  - **Windows (PowerShell/native):** `C:\Users\your-username\llm-peer-review`
  - **Windows (WSL):** `\\wsl.localhost\Ubuntu\home\your-username\llm-peer-review`
  - **Mac:** `/Users/your-username/llm-peer-review`
- Type `/explore` to verify the commands are working

You are set up. Now read the [Add to a New Project](README.md#add-to-a-new-project) section in the README to copy the toolkit into your actual projects.

> **Tip:** Next time, you can skip this manual walkthrough by pointing your AI agent at [AGENT-SETUP.md](AGENT-SETUP.md) and letting it do the install for you.

> **Important:** Do not copy command files to `~/.claude/commands/` (your home directory). Commands should only live inside each project's `.claude/commands/` folder. Global copies in the home directory override project copies, which means you'll get outdated commands even after updating the toolkit. If you have files there, delete them.
