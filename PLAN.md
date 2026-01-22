# LLM Peer Review – Implementation Plan

**Overall Progress:** `100%`

## TLDR

Build a V1 MVP web app where users enter a prompt; the app fetches responses from Claude and GPT in parallel, each model critiques the other’s response, then Claude summarizes both critiques with an unbiased takeaway. Users see the prompt, both responses side-by-side, both critiques, and the summary. Next.js 14 (App Router), TypeScript, Tailwind, Vercel. No auth, no DB.

## Critical Decisions

- **API keys**: `.env.local` only, server-side (API routes). Never expose keys to the client.
- **Models**: Claude Sonnet 4.5 (`claude-sonnet-4-5`), GPT 5.2 (`gpt-5.2`).
- **Flow**: 5 API calls — (1) Claude response, (2) GPT response (parallel with 1); (3) Claude critiques GPT, (4) GPT critiques Claude (parallel with 3); (5) Claude summarizes both critiques. Fail fast on any error.
- **Input**: 10,000 character limit on prompt. Enforce in UI and API.
- **Loading**: Single spinner; wait for all 5 calls before showing results.
- **Errors**: Fail fast with user-friendly messages (e.g. “Unable to connect to Claude. Please check your API key.”).
- **Copy**: Copy per section (Claude response, GPT response, Claude critique, GPT critique, summary).
- **“Start new review”**: Clear form and show “new review” UI, but keep previous prompt + results visible above (e.g. in a scrollable history/list).

---

## Tasks

- [x] 🟩 **Step 1: Project setup**
  - [x] 🟩 Create Next.js 14 app (App Router) with TypeScript and Tailwind.
  - [x] 🟩 Add `.env.local.example` with `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`; document in README.
  - [x] 🟩 Add `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` to `.gitignore` / ensure `.env.local` is never committed.

- [x] 🟩 **Step 2: Server-side API orchestration**
  - [x] 🟩 Create a single API route (e.g. `POST /api/review`) that:
    - Accepts `{ prompt: string }`.
    - Validates prompt (non-empty, ≤ 10,000 chars). Return 400 with user-friendly message if invalid.
    - Calls Claude and GPT in parallel for initial responses.
    - On success, calls Claude-to-critique-GPT and GPT-to-critique-Claude in parallel.
    - On success, calls Claude to summarize both critiques with an unbiased takeaway.
    - On any failure: fail fast, return 5xx with a user-friendly error message (no partial payload).
  - [x] 🟩 Use Anthropic SDK for Claude, OpenAI SDK for GPT. Read keys from `process.env`.

- [x] 🟩 **Step 3: Prompt engineering**
  - [x] 🟩 Define system/user prompts for: (a) initial response, (b) critique (each model critiques the other’s reply), (c) summary (Claude summarizes both critiques + takeaway). Keep prompts minimal and in code (no DB).

- [x] 🟩 **Step 4: Frontend – form and submit**
  - [x] 🟩 Single page: textarea for prompt, character count (e.g. “0 / 10,000”), submit button.
  - [x] 🟩 Disable submit when empty or > 10,000 chars. Show validation message if user exceeds limit.
  - [x] 🟩 On submit: POST to ` /api/review`, show loading spinner, disable form. On error: display user-friendly message, re-enable form.

- [x] 🟩 **Step 5: Frontend – results layout**
  - [x] 🟩 After successful response: display original prompt, then two-column layout (Claude vs GPT) for responses.
  - [x] 🟩 Below: sections for “Claude’s critique of GPT,” “GPT’s critique of Claude,” and “Summary & takeaway.”
  - [x] 🟩 Each section has a “Copy” button to copy that section’s text to clipboard. No mobile-responsive required.

- [x] 🟩 **Step 6: “Start new review” behavior**
  - [x] 🟩 Add “Start new review” button. On click: clear form, optionally scroll to form, but keep previous prompt + results visible above (e.g. above the form or in a simple list). No page refresh.

- [x] 🟩 **Step 7: Vercel deployment**
  - [x] 🟩 Add Vercel config if needed (e.g. `vercel.json`). Document setting `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in Vercel project env vars.
  - [x] 🟩 Deploy and verify full flow (submit → spinner → results → copy → start new review).

---

## Out of scope (V1)

- Auth, database, user accounts.
- Streaming responses.
- Mobile-specific layout.
- Persisting reviews or history across sessions.
