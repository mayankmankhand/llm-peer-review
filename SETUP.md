# Setting Up a Brand New Computer

Pick your operating system below, then continue with "Both Platforms" at the end.

## Windows

### Step 1: Install WSL

WSL (Windows Subsystem for Linux) lets you run a Linux terminal on Windows. The scripts in this toolkit need it.

- Open **PowerShell as Administrator** (right-click Start menu → PowerShell → Run as administrator)
- Run:
  ```powershell
  wsl --install
  ```
- Restart your computer
- After restart you'll be asked to create a username and password for Linux — write these down

> **Already have WSL but no Linux distribution?** Run `wsl --install -d Ubuntu` in PowerShell as Administrator, then restart.

### Step 2: Install Node.js

Node.js runs the dev-lead scripts (the ChatGPT/Gemini debate features). Install it inside your WSL terminal.

- Open your WSL terminal (search "Ubuntu" in the Windows Start menu)
- Run these commands one at a time:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  source ~/.bashrc
  nvm install 22
  nvm alias default 22
  ```

### Step 3: Install GitHub CLI

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

### Step 4: Install Cursor

- Go to [cursor.com](https://www.cursor.com) and download the Windows installer
- Install it normally — it's a desktop app on Windows but can open folders inside WSL

### Windows paths in WSL

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

Run this in your terminal (Ubuntu/WSL on Windows, Terminal on Mac):
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
  - **Windows (WSL):** `\\wsl.localhost\Ubuntu\home\your-username\llm-peer-review`
  - **Mac:** `/Users/your-username/llm-peer-review`
- Type `/explore` to test your first command

You're set up. Read the [Add to a New Project](README.md#add-to-a-new-project) section in the README to use this toolkit in your actual projects.
