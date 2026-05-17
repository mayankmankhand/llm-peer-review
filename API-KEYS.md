# Setting Up API Keys

The `/ask-gpt` and `/ask-gemini` commands need API keys to talk to ChatGPT and Gemini. This guide walks you through getting the keys and setting them up safely.

> **Don't need `/ask-gpt` or `/ask-gemini`?** Skip this entirely. No other command needs API keys. (`/review-browser` has its own optional Playwright install - see the optional-features block under [Update an Existing Project](README.md#update-an-existing-project) - but no key.)

---

## What Are API Keys?

An API key is a long secret string (looks like `sk-proj-abc123...`) that lets your code talk to an external service like OpenAI or Google. Think of it as a password tied to your billing account: anyone who has it can use it and rack up charges on your bill. Treat it like a credit card number.

**The golden rule:** Never paste an API key into your code, share it in chat, or commit it to git. Keep it in a separate place (a shell config file or `.env.local`) that only your machine reads.

---

## Step 1: Get Your Keys

### OpenAI (for `/ask-gpt`)

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in (or create a free account if you don't have one)
3. Click **Create new secret key**
4. Give it a name so you can recognize it later (e.g. "llm-peer-review")
5. Copy the key right away and paste it somewhere safe. OpenAI only shows it once; if you lose it you have to create a new one.
6. Add a few dollars of credit to your account at [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing). Without credits, the key exists but every request will fail.

Your key will look like: `sk-proj-abc123...`

### Google Gemini (for `/ask-gemini`)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Pick any Google Cloud project from the dropdown, or let it create one for you
5. Copy the key and paste it somewhere safe

Your key will look like: `AIzaSy...`

Gemini has a generous free tier, so you usually don't need to add billing to get started.

---

## Step 2: Set Up Your Keys

You have two options. Environment variables are safer. The `.env.local` file is easier. Pick one; you don't need both.

### Option A: Environment Variables (Recommended)

Environment variables are settings that live in your shell (the program that runs terminal commands). They're loaded into memory when you open a terminal and discarded when you close it. Nothing is written into your project folder, so there's nothing to accidentally commit to git.

**Bash or Zsh (macOS, Linux, WSL):**

Add these lines to your shell config file. Open it in your editor:

```bash
# For bash (most Linux, WSL):
nano ~/.bashrc

# For zsh (macOS default):
nano ~/.zshrc
```

Add at the bottom:

```bash
# API keys for LLM Peer Review toolkit
export OPENAI_API_KEY="sk-proj-your-key-here"
export GEMINI_API_KEY="AIzaSy-your-key-here"
```

Save the file, then reload it:

```bash
# For bash:
source ~/.bashrc

# For zsh:
source ~/.zshrc
```

**PowerShell (Windows):**

Open PowerShell and run:

```powershell
# Set permanently for your user account
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-proj-your-key-here", "User")
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "AIzaSy-your-key-here", "User")
```

Then restart PowerShell (or any open terminals) for the change to take effect.

### Option B: `.env.local` File (Easier, Less Safe)

This stores your keys in a file inside your project folder. The file is listed in `.gitignore` so git skips it, but the keys are still sitting in plain text on your disk.

```bash
# From your project directory:
cp .env.local.example .env.local
```

Then open `.env.local` and paste your keys:

```
OPENAI_API_KEY=sk-proj-your-key-here
GEMINI_API_KEY=AIzaSy-your-key-here
```

> **Why is this less safe?** The keys are written to a file. If someone copies your project folder, or if the `.gitignore` rule gets removed by accident, the keys could leak. Environment variables only exist in memory while your terminal is open, so they're harder to copy off your machine.

---

## Step 3: Verify It Works

Open a new terminal and run:

**Bash/Zsh:**
```bash
echo $OPENAI_API_KEY
echo $GEMINI_API_KEY
```

**PowerShell:**
```powershell
$env:OPENAI_API_KEY
$env:GEMINI_API_KEY
```

You should see your key values printed back. If you see a blank line, go back to Step 2 and make sure you reloaded your shell (or restarted PowerShell). A common mistake is editing `~/.bashrc` but forgetting to run `source ~/.bashrc`.

Then try running a debate from inside Claude Code or Cursor:
```
/ask-gpt
```

---

## Changing the Model

By default, `/ask-gpt` uses `gpt-5.5` and `/ask-gemini` uses `gemini-3.1-pro-preview`. You can change these with additional environment variables or `.env.local` entries:

```bash
# Environment variable (add to ~/.bashrc or ~/.zshrc):
export GPT_MODEL="gpt-4o"
export GEMINI_MODEL="gemini-2.0-flash"

# Or in .env.local:
GPT_MODEL=gpt-4o
GEMINI_MODEL=gemini-2.0-flash
```

### What if I see a "deprecated model" warning?

Starting in v4.5.0, the scripts protect you from running on an outdated default model. If your `.env.local` still has an old toolkit default (for example `GPT_MODEL=gpt-5.4` or `GEMINI_MODEL=gemini-3-flash-preview`) from a setup you did months ago, the script ignores that value, uses the current default instead, and prints a one-line warning like `Note: GPT_MODEL=gpt-5.4 in .env.local is deprecated. Using gpt-5.5.` This only affects a short list of previous toolkit defaults. Any other model name you set (such as `GPT_MODEL=gpt-4o`) is treated as a deliberate choice and used silently. To silence the warning, open `.env.local` and either update the value to a current model name or delete the line.

---

## FAQ

**Can I use just one key?** Yes. If you only set up an OpenAI key, `/ask-gpt` works and `/ask-gemini` will tell you it's missing a key. Same the other way around. Set up whichever one you actually plan to use.

**How much does it cost?** Each 3-round debate typically costs between $0.01 and $0.10 in API credits, depending on how much context (code, plan, conversation history) you send. You're billed by the API provider, not by this toolkit.

**I rotated my key. How do I update it?** Same as Step 2: replace the old key in `~/.bashrc`, `~/.zshrc`, your PowerShell environment, or `.env.local` with the new one, then open a new terminal (or run `source ~/.bashrc`) so the change takes effect.

**My key isn't working.** The most common cause is an account with no credits (OpenAI) or an API that hasn't been enabled (Gemini). Other things to check: you copied the whole key without trailing spaces, you're editing the file for the shell you actually use (bash vs zsh), and you opened a fresh terminal after the change.
