# Setting Up API Keys

The `/ask-gpt` and `/ask-gemini` commands need API keys to talk to ChatGPT and Gemini. This guide walks you through getting the keys and setting them up safely.

> **Don't need `/ask-gpt` or `/ask-gemini`?** Skip this entirely. The other 16 commands work without any API keys.

---

## What Are API Keys?

An API key is like a password that lets your code talk to an external service (OpenAI, Google, etc.). Anyone who has your key can use it and run up charges on your account, so you should treat it like a credit card number.

**The golden rule:** Never put API keys directly in your code or commit them to git.

---

## Step 1: Get Your Keys

### OpenAI (for `/ask-gpt`)

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in (or create an account)
3. Click **Create new secret key**
4. Give it a name like "llm-peer-review"
5. Copy the key immediately - you won't be able to see it again
6. You'll need credits on your account. Check [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing)

Your key will look like: `sk-proj-abc123...`

### Google Gemini (for `/ask-gemini`)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Pick any Google Cloud project (or create one)
5. Copy the key

Your key will look like: `AIzaSy...`

---

## Step 2: Set Up Your Keys

You have two options. Environment variables are safer. The `.env.local` file is easier.

### Option A: Environment Variables (Recommended)

Environment variables live in your shell's memory. They're never written to a file in your project, so there's nothing to accidentally commit.

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

This stores your keys in a file inside your project. The file is gitignored so it won't be committed, but the keys are sitting in plaintext on your disk.

```bash
# From your project directory:
cp .env.local.example .env.local
```

Then open `.env.local` and paste your keys:

```
OPENAI_API_KEY=sk-proj-your-key-here
GEMINI_API_KEY=AIzaSy-your-key-here
```

> **Why is this less safe?** The keys are in a file. If someone gets access to your computer, copies your project folder, or if the `.gitignore` rule is ever removed, the keys could leak. Environment variables only exist in memory while your terminal is open.

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

You should see your key values printed. If you see nothing, go back to Step 2 and make sure you reloaded your shell.

Then try running a debate:
```
/ask-gpt
```

---

## Changing the Model

By default, `/ask-gpt` uses `gpt-5.4` and `/ask-gemini` uses `gemini-3.1-pro-preview`. You can change these with additional environment variables or `.env.local` entries:

```bash
# Environment variable (add to ~/.bashrc or ~/.zshrc):
export GPT_MODEL="gpt-4o"
export GEMINI_MODEL="gemini-2.0-flash"

# Or in .env.local:
GPT_MODEL=gpt-4o
GEMINI_MODEL=gemini-2.0-flash
```

---

## FAQ

**Can I use just one key?** Yes. If you only set up an OpenAI key, `/ask-gpt` works and `/ask-gemini` will tell you it's missing a key. Same the other way around.

**How much does it cost?** Each 3-round debate typically costs $0.01-$0.10 in API credits depending on how much context you send.

**I rotated my key. How do I update it?** Same as Step 2 - update your `~/.bashrc` / `~/.zshrc` / PowerShell or `.env.local` with the new key, then reload your terminal.

**My key isn't working.** Check that your account has credits (OpenAI) or that the API is enabled (Gemini). The most common issue is an expired or zero-balance account.
