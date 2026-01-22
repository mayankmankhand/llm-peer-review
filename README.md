# LLM Peer Review

A tool where you enter a prompt; the app fetches responses from **Claude** and **GPT** in parallel, each model critiques the other's response, then **Claude** summarizes both critiques with an unbiased takeaway.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment variables**

   Copy `.env.local.example` to `.env.local` and add your API keys:

   ```bash
   cp .env.local.example .env.local
   ```

   Then set:

   - `ANTHROPIC_API_KEY` — [Anthropic API](https://console.anthropic.com/)
   - `OPENAI_API_KEY` — [OpenAI API](https://platform.openai.com/api-keys)

   Never commit `.env.local`; it's gitignored.

3. **Run locally**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Deploy (Vercel)

1. **Connect the repo** to Vercel (Git integration) or deploy with the [Vercel CLI](https://vercel.com/cli): `npx vercel`.

2. **Environment variables**  
   In your Vercel project: **Settings → Environment Variables**. Add:
   - `ANTHROPIC_API_KEY` — your [Anthropic API](https://console.anthropic.com/) key  
   - `OPENAI_API_KEY` — your [OpenAI API](https://platform.openai.com/api-keys) key  

   Enable them for **Production**, **Preview**, and **Development** as needed.

3. **Redeploy** after adding env vars so they're available at runtime.

Vercel auto-detects Next.js; no `vercel.json` is required for this app.
