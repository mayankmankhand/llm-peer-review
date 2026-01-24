# Dev Lead 2 (Gemini) Implementation Plan

**Overall Progress:** `100%`

## TLDR
Add `/dev-lead-2` slash command that uses Google's Gemini 2.5 Pro for AI peer review, following the same 3-round debate workflow as `/dev-lead-1` (which uses ChatGPT).

## Critical Decisions
- **Separate script**: Create `dev-lead-gemini.js` instead of adding provider logic to existing script - simpler, easier to maintain
- **Same prompts**: Reuse the same reviewer/debate/summary prompts - they work across models
- **Configurable model**: Add `GEMINI_MODEL` env var (default: `gemini-2.5-pro`)

## Post-Review Improvements (from ChatGPT debate)
- **Removed unused timeout config** - Eliminated dead code
- **Added systemInstruction support** - Uses Gemini's native system prompt with env-toggle fallback
- **Added single retry with transparency** - One retry on transient errors with message
- **Hardened .env parsing** - Skips empty/comment lines, trims keys
- **Added scope documentation** - Clear assumptions in script header
- **Added npm script** - `npm run dev-lead-gemini` for convenience

## Tasks

- [x] 🟩 **Step 1: Create Gemini script**
  - [x] 🟩 Create `scripts/dev-lead-gemini.js` based on `dev-lead.js`
  - [x] 🟩 Replace OpenAI client with `@google/generative-ai`
  - [x] 🟩 Update API call to use Gemini's `generateContent()` method
  - [x] 🟩 Update env var names to `GEMINI_API_KEY` and `GEMINI_MODEL`

- [x] 🟩 **Step 2: Create command file**
  - [x] 🟩 Create `.claude/commands/dev-lead-2.md`
  - [x] 🟩 Copy from `dev-lead-1.md`, update script references to use `dev-lead-gemini.js`
  - [x] 🟩 Update title/description to mention Gemini

- [x] 🟩 **Step 3: Update environment example**
  - [x] 🟩 Add `GEMINI_API_KEY` to `.env.local.example`
  - [x] 🟩 Add `GEMINI_MODEL` with default comment

- [x] 🟩 **Step 4: Install dependency**
  - [x] 🟩 Run `npm install @google/generative-ai`

- [x] 🟩 **Step 5: Test**
  - [x] 🟩 Verify script runs with `--help`
  - [ ] 🟥 Test with actual Gemini API key (manual - requires your API key)
