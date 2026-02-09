# Setting Up a Brand New Computer

Pick your operating system below, then continue with "Both Platforms" at the end.

## Windows

You can use this toolkit in **two ways** on Windows:

- **Option A (recommended): WSL + bash** for parity with Linux/macOS workflows
- **Option B: Native Windows PowerShell** using `scripts/setup/setup.ps1` (no WSL required)

### Step 1: Install Node.js

Node.js runs the dev-lead scripts (the ChatGPT/Gemini debate features).

- Install from [nodejs.org](https://nodejs.org) (LTS is fine), then reopen terminal
- Verify:
  ```powershell
  node -v
  npm -v
  ```

### Step 2: Install GitHub CLI

Needed for the `/create-issue` command.

- Install from [cli.github.com](https://cli.github.com)
- Log in:
  ```powershell
  gh auth login
  ```

### Step 3: Install Cursor

- Go to [cursor.com](https://www.cursor.com) and download the Windows installer
- Install it normally

### Step 4 (Optional): Install WSL if you prefer bash workflow

WSL (Windows Subsystem for Linux) gives you a Linux terminal on Windows. If you want bash-first setup and Linux path style:

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
Follow the prompts — it opens a browser to authenticate.

### Step 4: Install Cursor

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

### Step 6: Get API Keys (Optional)

You only need these if you want `/dev-lead-gpt` and `/dev-lead-gemini`. Both services have free tiers.

- **OpenAI key:** Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → create a key → copy it
- **Gemini key:** Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → create a key → copy it

Save these somewhere safe. You'll paste them in Step 8.

### Step 7: Clone This Repo

Run this in your terminal (PowerShell or WSL on Windows, Terminal on Mac):
```bash
git clone https://github.com/mayankmankhand/llm-peer-review.git
cd llm-peer-review
npm install
```

### Step 8: Set Up API Keys

```bash
cp .env.local.example .env.local
```

Open `.env.local` and paste in your keys from Step 6:
```
OPENAI_API_KEY=sk-your-key-here
GEMINI_API_KEY=AIza-your-key-here
```

### Step 9: Open in Cursor and Test

- Open Cursor → File → Open Folder
- Navigate to your `llm-peer-review` folder:
  - **Windows (PowerShell/native):** `C:\Users\your-username\llm-peer-review`
  - **Windows (WSL):** `\\wsl.localhost\Ubuntu\home\your-username\llm-peer-review`
  - **Mac:** `/Users/your-username/llm-peer-review`
- Type `/explore` to test your first command

You're set up. Read the [Add to a New Project](README.md#add-to-a-new-project) section in the README to use this toolkit in your actual projects.
