#!/usr/bin/env node

/**
 * Ask Gemini - Automated AI Peer Review Script
 *
 * Standalone Node.js script for running peer review debates using Google Gemini.
 * Handles Gemini API calls, manages debate context, and orchestrates multi-turn
 * review cycles. Can be invoked from CLI, Cursor, or integrated into workflows.
 *
 * Intentionally kept as a standalone script (no shared provider module) for
 * independent model flexibility, per-provider error handling, and simpler debugging.
 *
 * Commands:
 *   review   - Get initial review from Gemini
 *   respond  - Get Gemini's response to Claude's feedback
 *   summary  - Generate final debate summary
 *
 * Usage:
 *   node .claude/scripts/ask-gemini.js review --context-file <path> [--review-type <type>]
 *   node .claude/scripts/ask-gemini.js respond --context-file <path> --debate-file <path>
 *   node .claude/scripts/ask-gemini.js summary --context-file <path> --debate-file <path>
 * 
 * Environment:
 *   GEMINI_API_KEY            Required for Gemini API calls
 *   GEMINI_MODEL              Optional model override (default: gemini-3.6-flash).
 *                             Known-stale values are auto-overridden with a warning.
 *   GEMINI_MAX_TOKENS         Optional maxOutputTokens override (default: 32000).
 *                             Covers thinking + visible output for reasoning models.
 *   GEMINI_USE_CONCAT_PROMPT  Set to "1" to use concatenated prompts instead of systemInstruction
 * 
 * Scope & Assumptions:
 *   - Designed for Linux/WSL environments
 *   - Expects simple .env.local format (KEY=value, no quotes needed)
 *   - Fail-fast philosophy with one transparent retry on transient errors
 *   - SDK version: @google/genai ^1.x (systemInstruction passed via config)
 */

const fs = require('fs');
const path = require('path');

/**
 * Load environment variables from .env.local
 *
 * This is a simple implementation for learning purposes.
 * For production use, consider the 'dotenv' package which handles
 * more edge cases (quoted values, multiline, variable expansion).
 *
 * Resolution: walk upward from this script looking for the project root.
 * The first directory with a `.env.local` OR a `.git` OR a `package.json`
 * counts as root. This survives:
 *   - the canonical install at `<project>/.claude/scripts/`
 *   - dev runs from inside the toolkit repo
 *   - symlinked installs (Node sets __dirname to the symlink target)
 *   - worktrees that inherit the same layout
 * If no marker is found within 6 levels we give up; .env.local is optional
 * and the script continues with whatever's already in process.env.
 */
function findEnvLocal(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, '.env.local');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to the canonical install location. The existsSync at the call
  // site treats a missing file as "no env to load" without erroring.
  return path.join(startDir, '..', '..', '.env.local');
}
const envPath = findEnvLocal(__dirname);
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    // Skip empty lines and comments
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }
    
    const match = trimmedLine.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      // Strip surrounding quotes (single or double) that some tutorials show
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      // Only set if not already in environment
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Model defaults. When bumping the default here, append the previous default
// to KNOWN_STALE_GEMINI_MODELS so users with that value in .env.local are
// auto-routed to the new model with a warning instead of silently running on
// an old model. setup.sh greps the DEFAULT_GEMINI_MODEL line to display the
// current default at end of setup - keep the `const NAME = 'value';` shape.
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const KNOWN_STALE_GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'];

/**
 * Resolve which model to use. The hardcoded default wins over a stale env
 * override so latest toolkit = latest model. Custom env values (not on the
 * stale list, not the current default) are respected.
 */
function resolveModel() {
  const envValue = process.env.GEMINI_MODEL;
  if (!envValue) return DEFAULT_GEMINI_MODEL;
  // Case-insensitive match so values like `Gemini-3-Flash-Preview` (wrong
  // casing from a copy-paste) still trigger the override.
  const isStale = KNOWN_STALE_GEMINI_MODELS.some(m => m.toLowerCase() === envValue.toLowerCase());
  if (isStale) {
    // stderr so the warning stays out of the captured debate transcript
    // that downstream `/ask-gemini` rounds re-read.
    console.error(`⚠️  Note: GEMINI_MODEL=${envValue} in .env.local is deprecated. Using ${DEFAULT_GEMINI_MODEL}. Edit .env.local to silence this.`);
    return DEFAULT_GEMINI_MODEL;
  }
  return envValue;
}

// Configuration
const CONFIG = {
  model: resolveModel(),
  // 32000 sits well below gemini-3.6-flash's 65,536 output cap and above the
  // SDK's own 8192 default. The previous 4096 was BELOW the SDK default, which
  // is why long reviews truncated mid-sentence. Gemini 3.x thinking tokens
  // share this budget with visible output. The cap is a ceiling, not a target:
  // the model only uses what it needs. Lower via GEMINI_MAX_TOKENS if cost-sensitive.
  maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS, 10) || 32000,
  useConcatPrompt: process.env.GEMINI_USE_CONCAT_PROMPT === '1',
  retryDelayMs: 1000,
};

// Constants
const MAX_FILE_SIZE = 500 * 1024; // 500KB

// Error messages
const ERR = {
  MISSING_KEY: 'GEMINI_API_KEY not found. Add it to .env.local',
  MISSING_ARG: (arg) => `Missing required argument: ${arg}`,
  FILE_NOT_FOUND: (f) => `File not found: ${f}`,
  FILE_TOO_LARGE: (f, sizeMB) =>
    `File is too large (${sizeMB} MB). Maximum size is 500KB. Try a smaller file or use /package-review to select specific files.`,
  API_ERROR: (msg) => `Gemini API error: ${msg}`,
  UNKNOWN_CMD: (cmd) => `Unknown command: ${cmd}. Use review, respond, or summary.`,
};

/**
 * Load the canonical finding template from the shared /review template.
 *
 * Slices the "Base Format" section out of .claude/skills/shared/output-template.md
 * by splitting on "## Illustrative Examples", so the debate summary prompt gets
 * the format spec without the per-domain example flood. Single source of truth:
 * editing the shared template propagates to /review skills AND to this script.
 *
 * Throws loudly on missing file or missing slice marker. A silent fallback would
 * ship a malformed summary; loud failure forces the install or rename to be fixed.
 */
function loadOutputTemplate() {
  const templatePath = path.join(__dirname, '..', 'skills', 'shared', 'output-template.md');
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Shared output template not found at ${templatePath}. ` +
      `The /ask-gemini summary inlines this file for the canonical finding format. ` +
      `Restore it from git with \`git checkout HEAD -- .claude/skills/shared/output-template.md\` or re-run the toolkit installer from your llm-peer-review clone.`
    );
  }
  const content = fs.readFileSync(templatePath, 'utf-8');
  const marker = '## Illustrative Examples';
  const splitIndex = content.indexOf(marker);
  if (splitIndex === -1) {
    throw new Error(
      `Slice marker "${marker}" not found in ${templatePath}. ` +
      `loadOutputTemplate() uses this heading to isolate the Base Format section. ` +
      `If the heading was renamed in the shared template, update the marker constant in BOTH .claude/scripts/ask-gpt.js AND .claude/scripts/ask-gemini.js to match (mirror parity required).`
    );
  }
  return content.slice(0, splitIndex).trim();
}

// Cache for the lazily-built summary prompt. Populated on first access to
// PROMPTS.summary and reused for the rest of the process. Module-scoped so
// the getter can read and write it across calls without leaking state onto
// the PROMPTS object itself.
let _cachedSummaryPrompt = null;

// Prompt templates for Gemini review debates
const PROMPTS = {
  reviewer: `You are a senior engineer conducting a peer review. Your role is to provide constructive, actionable feedback.

Guidelines:
- Be specific: Point to exact issues, not vague concerns
- Be constructive: Suggest fixes, not just problems
- Be prioritized: Use 🚫 (Block - must fix before shipping), ⚠️ (Warn - should fix before shipping), or 💡 (Suggest - nice to have)
- Be fair: Acknowledge strengths as well as weaknesses
- Be practical: Focus on real-world impact, not theoretical perfection

Structure your review as:

## Summary
Brief overall assessment (2-3 sentences)

## Issues Found
For each issue, use a sequential R-ID (R1, R2, R3, ...) and a severity emoji. Mid-debate findings stay concise (Problem + Suggestion); the full two-sentence contract is only required in the final summary.
- **R1** 🚫 Issue title (file:line)
  - Problem: What's wrong
  - Suggestion: How to fix it

## Strengths
What's done well (bullet points)

## Questions
Any clarifying questions for the author`,

  debateFollowup: `You are continuing a peer review discussion. The author has responded to your feedback.

Guidelines:
- Acknowledge when the author makes valid counter-points
- Provide additional context if your feedback was misunderstood
- Concede gracefully when convinced otherwise
- Press on issues that remain unresolved
- Stay focused on the most important points

Structure your response as:

## Resolved
Points that are now settled (acknowledged by you)

## Still Discussing
Ongoing disagreements with your updated perspective

## New Observations
Any new points based on the author's response`,

  // Lazily build and cache the summary prompt on first access. The shared
  // output template is read once per process; subsequent reads (e.g., from a
  // future debug log accessing PROMPTS.summary twice) reuse the cached string.
  // Lazy evaluation also keeps `review` and `respond` working when the template
  // file is missing - they do not access this getter.
  get summary() {
    if (_cachedSummaryPrompt) return _cachedSummaryPrompt;
    _cachedSummaryPrompt = `You are summarizing a peer review debate between two engineers (Gemini as Reviewer, Claude as Author). Produce a clear, actionable summary.

The user will display your output under a "## Lead Reviewer Summary" header. Emit exactly these five sections, in order, each as an H3:

### ✅ Agreed Points
Points where both reached consensus, as terse bullets:
- [Point 1]
- [Point 2]

### 🤔 Disagreed Points
Points where there was no resolution, as terse bullets:
- **[Topic]**: Reviewer's view vs Author's view

### Top Issues
A scannable line of finding counts in this format (from the canonical template):
🚫 X Blocks: R1 (file:line - one-line What), R3 (file:line - one-line What)
⚠️ X Warns: R2 (file:line - one-line What)
💡 X Suggests: R4 (file:line - one-line What)

### 📋 Recommended Actions
Each action uses the full two-sentence contract from the canonical template below: sentence one, an optional sentence two, then a fix line. Use 🚫 (Block), ⚠️ (Warn), or 💡 (Suggest) emojis with sequential R-IDs (R1, R2, R3, ...). Mine the debate transcript (up to 3 rounds) for the reasoning behind each action, and spend what you find on picking the right sentence rather than on adding another one. The caps hold here exactly as they do in a review. Do NOT use [CRITICAL]/[MAJOR]/[MINOR] tags.

### 💬 Key Insights
Notable observations from the debate worth remembering, as terse bullets.

The canonical /review output template is inlined below in <shared_template> tags. Apply the Top Issues format and the Findings two-sentence contract to this debate summary. Ignore the Looks Good, Staff Check, Files-reviewed Summary, and Where-the-report-is-written sections inside the template - those are for full /review runs, not for debate summaries.

<shared_template>
${loadOutputTemplate()}
</shared_template>`;
    return _cachedSummaryPrompt;
  },
};

/**
 * Check if an error is transient and worth retrying.
 * Covers: timeouts, rate limits (429), server errors (5xx).
 */
function isTransientError(errorMsg) {
  const transientPatterns = [
    /timeout|timed out|ETIMEDOUT|aborted/i,
    /\b429\b|rate.?limit|too.?many.?requests/i,
    /\b50[0-9]\b|internal.?server|service.?unavailable|bad.?gateway/i,
    /ECONNRESET|ECONNREFUSED|ENOTFOUND/i,
  ];
  return transientPatterns.some(pattern => pattern.test(errorMsg));
}

/**
 * Get the next argument value, ensuring it's not another flag or missing.
 * Only checks for '--' prefix: this toolkit uses long flags exclusively,
 * so single-dash rejection is not needed.
 */
function nextArgValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    console.error(`\n❌ Error: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const parsed = {
    command,
    contextFile: null,
    debateFile: null,
    reviewType: 'code',
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--context-file':
        parsed.contextFile = nextArgValue(args, ++i, '--context-file');
        break;
      case '--debate-file':
        parsed.debateFile = nextArgValue(args, ++i, '--debate-file');
        break;
      case '--review-type':
        parsed.reviewType = nextArgValue(args, ++i, '--review-type');
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        console.error(`\n❌ Error: Unknown argument: ${args[i]}. Use --help to see options.`);
        process.exit(1);
    }
  }

  return parsed;
}

/**
 * Print help message.
 */
function printHelp() {
  console.log(`
Ask Gemini - Automated AI Peer Review

Commands:
  review    Get initial review from Gemini
  respond   Get Gemini's response to Claude's feedback
  summary   Generate final debate summary

Usage:
  node .claude/scripts/ask-gemini.js review --context-file <path> [--review-type <type>]
  node .claude/scripts/ask-gemini.js respond --context-file <path> --debate-file <path>
  node .claude/scripts/ask-gemini.js summary --context-file <path> --debate-file <path>

Options:
  --context-file   Path to file with content to review (required)
  --debate-file    Path to file with debate history (for respond/summary)
  --review-type    Type: plan, code, branch, feature (default: code)
  --help           Show this help message

Environment:
  GEMINI_API_KEY            Required for Gemini API calls
  GEMINI_MODEL              Model to use (default: gemini-3.6-flash)
                            Stale values are auto-overridden with a warning.
  GEMINI_MAX_TOKENS         maxOutputTokens budget (default: 32000)
                            Covers thinking + visible output for reasoning models.
  GEMINI_USE_CONCAT_PROMPT  Set to "1" to use fallback concatenated prompts

Examples:
  # Initial review
  node .claude/scripts/ask-gemini.js review --context-file context.md --review-type plan

  # After Claude responds, get Gemini's follow-up
  node .claude/scripts/ask-gemini.js respond --context-file context.md --debate-file debate.md

  # Generate final summary
  node .claude/scripts/ask-gemini.js summary --context-file context.md --debate-file debate.md
  `);
}

/**
 * Read file content.
 * Checks file size before reading to prevent oversized payloads.
 */
function readFile(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(ERR.FILE_NOT_FOUND(filePath));
  }

  const stats = fs.statSync(absolutePath);
  if (stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    throw new Error(ERR.FILE_TOO_LARGE(filePath, sizeMB));
  }

  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * Warn if --context-file and --debate-file have different session ID suffixes.
 * The slash command generates a per-session ID and embeds it in both filenames
 * (e.g., /tmp/ask-gemini-context-1747700000-29481.md). A mismatch means the
 * runner likely regenerated the ID mid-flow, which would split the debate
 * across two file pairs and break script continuity. Warning only, not an
 * error: the script still runs with whatever paths it was given.
 */
function warnIfSessionMismatch(contextFile, debateFile) {
  const extractId = (p) => path.basename(p).match(/-(\d+-\d+)\.md$/)?.[1];
  const ctxId = extractId(contextFile);
  const debId = extractId(debateFile);
  if (ctxId && debId && ctxId !== debId) {
    console.error(`⚠️  Warning: context file and debate file have different session IDs (${ctxId} vs ${debId}). The debate may be missing earlier rounds.`);
  }
}

/**
 * Initialize GoogleGenAI client.
 * Creates the client once; call buildRequest() to assemble per-call params.
 */
function initGemini() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(ERR.MISSING_KEY);
  }

  const { GoogleGenAI } = require('@google/genai');
  return new GoogleGenAI({ apiKey });
}

/**
 * Build the per-call request shape for client.models.generateContent.
 * The new SDK has no separate model object; model name and config travel
 * with each request. The caller adds `contents` per call.
 * Uses systemInstruction in config unless fallback mode is enabled.
 */
function buildRequest(systemPrompt) {
  const config = {
    maxOutputTokens: CONFIG.maxTokens,
  };

  // Use systemInstruction unless fallback mode is enabled
  if (!CONFIG.useConcatPrompt && systemPrompt) {
    config.systemInstruction = systemPrompt;
  }

  return {
    model: CONFIG.model,
    config,
  };
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini with the given prompts.
 * Uses systemInstruction by default, falls back to concatenation if GEMINI_USE_CONCAT_PROMPT=1.
 * Includes one transparent retry on transient errors.
 */
async function callGemini(client, systemPrompt, userPrompt) {
  const { model, config } = buildRequest(systemPrompt);

  // Build the prompt based on mode
  const contents = CONFIG.useConcatPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  let lastError;

  // Try up to 2 times (initial + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Progress indicator for long API calls
    const progressTimer = setTimeout(() => {
      console.log('⏳ Still waiting for response...');
    }, 10000);

    let response;
    try {
      response = await client.models.generateContent({ model, contents, config });
    } catch (error) {
      clearTimeout(progressTimer);
      const msg = error instanceof Error ? error.message : String(error);
      lastError = msg;

      // Check if this is a transient error worth retrying
      if (attempt === 1 && isTransientError(msg)) {
        console.log(`⚠️  Transient error detected, retrying in ${CONFIG.retryDelayMs}ms...`);
        await sleep(CONFIG.retryDelayMs);
        continue;
      }

      // Non-transient error or second attempt failed
      if (/timeout|timed out|ETIMEDOUT|aborted/i.test(msg)) {
        throw new Error('Request timed out. Try again.');
      }
      throw new Error(ERR.API_ERROR(msg));
    }

    clearTimeout(progressTimer);

    // Gemini 3.x thinking tokens can consume the entire maxOutputTokens budget,
    // leaving no visible output (finishReason: "MAX_TOKENS", text: ""). Surface
    // the cause instead of returning an empty string silently. Also surfaces
    // safety-blocked responses and other non-error empty bodies.
    //
    // Empty-body errors thrown here stay UNWRAPPED (not prefixed with "Gemini API
    // error:" via ERR.API_ERROR) because they are first-class non-transport
    // errors. The message itself names the cause and the fix, so prefixing would
    // just add noise. Transport errors (caught above) get wrapped because their
    // raw messages are vendor-specific and the prefix gives context.
    const text = response.text;
    const candidate = response.candidates?.[0];
    // Token counts from usageMetadata are included in both the empty-body error
    // and the truncation warning, so users can decide whether to raise the cap
    // or switch models. Mirror parity with the GPT side.
    const thoughtsTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
    const candidatesTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    if (typeof text !== 'string' || text.trim() === '') {
      const finishReason = candidate?.finishReason || 'unknown';
      const blockedSafety = (candidate?.safetyRatings || []).filter(r => r.blocked);
      if (blockedSafety.length > 0) {
        const categories = blockedSafety.map(r => r.category).join(', ');
        throw new Error(`Gemini blocked the response on safety grounds (${categories}).`);
      }
      throw new Error(
        `Gemini returned empty body (finishReason: ${finishReason}, thoughts_tokens: ${thoughtsTokens}, candidates_tokens: ${candidatesTokens}). Raise GEMINI_MAX_TOKENS or shorten the input.`
      );
    }

    // Warn (but don't fail) when content is non-empty but truncated at the
    // token cap. The user still wants the partial output, but needs to know
    // it's incomplete so they can rerun with a higher GEMINI_MAX_TOKENS if needed.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      console.error(`⚠️  Warning: response truncated at token cap (finishReason: MAX_TOKENS, thoughts_tokens: ${thoughtsTokens}, candidates_tokens: ${candidatesTokens}). Raise GEMINI_MAX_TOKENS for complete output.`);
    }
    return text.trim();
  }

  // Should not reach here, but just in case
  throw new Error(ERR.API_ERROR(lastError));
}

/**
 * Command: Initial review from Gemini.
 */
async function cmdReview(client, context, reviewType) {
  console.log('📝 Getting initial review from Gemini...\n');

  const userMessage = `Please review the following ${reviewType}:

---

${context}

---

Provide your peer review following the structure in your instructions.`;

  const response = await callGemini(client, PROMPTS.reviewer, userMessage);

  console.log('--- Gemini Review ---\n');
  console.log(response);
  console.log('\n--- End Review ---');

  return response;
}

/**
 * Command: Get Gemini's response to Claude's feedback.
 */
async function cmdRespond(client, context, debateHistory) {
  console.log('🔄 Getting Gemini response to Claude...\n');

  const userMessage = `Original content under review:

---

${context}

---

Debate so far:

---

${debateHistory}

---

Continue the peer review discussion. Respond to the author's latest points following the structure in your instructions.`;

  const response = await callGemini(client, PROMPTS.debateFollowup, userMessage);

  console.log('--- Gemini Response ---\n');
  console.log(response);
  console.log('\n--- End Response ---');

  return response;
}

/**
 * Command: Generate final summary.
 */
async function cmdSummary(client, context, debateHistory) {
  console.log('📊 Generating debate summary...\n');

  const userMessage = `Original content reviewed:

---

${context}

---

Complete peer review debate:

---

${debateHistory}

---

Synthesize this debate into the structured summary format in your instructions.`;

  const response = await callGemini(client, PROMPTS.summary, userMessage);

  console.log('--- Debate Summary ---\n');
  console.log(response);
  console.log('\n--- End Summary ---');

  return response;
}

/**
 * Main execution.
 */
async function main() {
  const args = parseArgs();

  if (!args.command || args.command === '--help') {
    printHelp();
    process.exit(0);
  }

  // Make the model in use visible on every run so users can confirm the
  // toolkit picked up the right model and spot stale-value overrides.
  // stderr so this diagnostic stays out of the captured debate transcript.
  console.error(`Using Gemini model: ${CONFIG.model}`);

  try {
    const client = initGemini();

    switch (args.command) {
      case 'review': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        const context = readFile(args.contextFile);
        await cmdReview(client, context, args.reviewType);
        break;
      }

      case 'respond': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        if (!args.debateFile) {
          throw new Error(ERR.MISSING_ARG('--debate-file'));
        }
        warnIfSessionMismatch(args.contextFile, args.debateFile);
        const context = readFile(args.contextFile);
        const debate = readFile(args.debateFile);
        await cmdRespond(client, context, debate);
        break;
      }

      case 'summary': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        if (!args.debateFile) {
          throw new Error(ERR.MISSING_ARG('--debate-file'));
        }
        warnIfSessionMismatch(args.contextFile, args.debateFile);
        const context = readFile(args.contextFile);
        const debate = readFile(args.debateFile);
        await cmdSummary(client, context, debate);
        break;
      }

      default:
        throw new Error(ERR.UNKNOWN_CMD(args.command));
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
