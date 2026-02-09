#!/usr/bin/env node

/**
 * Dev Lead Gemini - Automated AI Peer Review Script
 * 
 * Handles Google Gemini API calls for the peer review debate.
 * Claude (in Cursor) orchestrates the flow and provides responses.
 * 
 * NOTE: This script is intentionally kept separate from its counterpart
 * (dev-lead-gpt.js) to maintain simplicity and clarity for learning purposes,
 * avoiding abstractions like a shared provider module.
 * 
 * Commands:
 *   review   - Get initial review from Gemini
 *   respond  - Get Gemini's response to Claude's feedback
 *   summary  - Generate final debate summary
 * 
 * Usage:
 *   node scripts/dev-lead-gemini.js review --context-file <path> [--review-type <type>]
 *   node scripts/dev-lead-gemini.js respond --context-file <path> --debate-file <path>
 *   node scripts/dev-lead-gemini.js summary --context-file <path> --debate-file <path>
 * 
 * Environment:
 *   GEMINI_API_KEY            Required for Gemini API calls
 *   GEMINI_MODEL              Optional model override (default: gemini-3-flash-preview)
 *   GEMINI_USE_CONCAT_PROMPT  Set to "1" to use concatenated prompts instead of systemInstruction
 * 
 * Scope & Assumptions:
 *   - Designed for Linux/WSL environments
 *   - Expects simple .env.local format (KEY=value, no quotes needed)
 *   - Fail-fast philosophy with one transparent retry on transient errors
 *   - SDK version: @google/generative-ai ^0.24.x (supports systemInstruction)
 */

const fs = require('fs');
const path = require('path');

/**
 * Load environment variables from .env.local
 * 
 * This is a simple implementation for learning purposes.
 * For production use, consider the 'dotenv' package which handles
 * more edge cases (quoted values, multiline, variable expansion).
 */
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    // Skip empty lines and comments
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }
    
    const match = trimmedLine.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      // Only set if not already in environment
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Configuration
const CONFIG = {
  model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  maxTokens: 4096,
  useConcatPrompt: process.env.GEMINI_USE_CONCAT_PROMPT === '1',
  retryDelayMs: 1000,
};

// Error messages
const ERR = {
  MISSING_KEY: 'GEMINI_API_KEY not found. Add it to .env.local',
  MISSING_ARG: (arg) => `Missing required argument: ${arg}`,
  FILE_NOT_FOUND: (f) => `File not found: ${f}`,
  API_ERROR: (msg) => `Gemini API error: ${msg}`,
  UNKNOWN_CMD: (cmd) => `Unknown command: ${cmd}. Use review, respond, or summary.`,
};

// Prompt templates (same as ChatGPT version - prompts work across models)
const PROMPTS = {
  reviewer: `You are a senior engineer conducting a peer review. Your role is to provide constructive, actionable feedback.

Guidelines:
- Be specific: Point to exact issues, not vague concerns
- Be constructive: Suggest fixes, not just problems
- Be prioritized: Mark issues as Critical, Major, or Minor
- Be fair: Acknowledge strengths as well as weaknesses
- Be practical: Focus on real-world impact, not theoretical perfection

Structure your review as:

## Summary
Brief overall assessment (2-3 sentences)

## Issues Found
For each issue:
- **[CRITICAL/MAJOR/MINOR]** Issue title
  - Location: Where in the code/plan
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

  summary: `You are summarizing a peer review debate between two engineers (Gemini as Reviewer, Claude as Author). Produce a clear, actionable summary.

Output this exact structure:

## Agreed Points
Points where both reached consensus:
- [Point 1]
- [Point 2]

## Disagreed Points
Points where there was no resolution:
- **[Topic]**: Reviewer's view vs Author's view

## Recommended Actions
Prioritized list of concrete actions:
1. [CRITICAL] Action description
2. [MAJOR] Action description  
3. [MINOR] Action description

## Key Insights
Notable observations from the debate worth remembering`,
};

/**
 * Check if an error is transient and worth retrying.
 * Covers: timeouts, rate limits (429), server errors (5xx).
 */
function isTransientError(errorMsg) {
  const transientPatterns = [
    /timeout|timed out|ETIMEDOUT|aborted/i,
    /429|rate.?limit|too.?many.?requests/i,
    /50[0-9]|internal.?server|service.?unavailable|bad.?gateway/i,
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
    }
  }

  return parsed;
}

/**
 * Print help message.
 */
function printHelp() {
  console.log(`
Dev Lead Gemini - Automated AI Peer Review

Commands:
  review    Get initial review from Gemini
  respond   Get Gemini's response to Claude's feedback  
  summary   Generate final debate summary

Usage:
  node scripts/dev-lead-gemini.js review --context-file <path> [--review-type <type>]
  node scripts/dev-lead-gemini.js respond --context-file <path> --debate-file <path>
  node scripts/dev-lead-gemini.js summary --context-file <path> --debate-file <path>

Options:
  --context-file   Path to file with content to review (required)
  --debate-file    Path to file with debate history (for respond/summary)
  --review-type    Type: plan, code, branch, feature (default: code)
  --help           Show this help message

Environment:
  GEMINI_API_KEY            Required for Gemini API calls
  GEMINI_MODEL              Model to use (default: gemini-3-flash-preview)
  GEMINI_USE_CONCAT_PROMPT  Set to "1" to use fallback concatenated prompts

Examples:
  # Initial review
  node scripts/dev-lead-gemini.js review --context-file context.md --review-type plan

  # After Claude responds, get Gemini's follow-up
  node scripts/dev-lead-gemini.js respond --context-file context.md --debate-file debate.md

  # Generate final summary
  node scripts/dev-lead-gemini.js summary --context-file context.md --debate-file debate.md
  `);
}

/**
 * Read file content.
 */
function readFile(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(ERR.FILE_NOT_FOUND(filePath));
  }

  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * Initialize Gemini client.
 * Returns the generative model instance ready for use.
 * Uses systemInstruction when available, unless fallback mode is enabled.
 */
function initGemini(systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(ERR.MISSING_KEY);
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Build model config
  const modelConfig = {
    model: CONFIG.model,
    generationConfig: {
      maxOutputTokens: CONFIG.maxTokens,
    },
  };

  // Use systemInstruction unless fallback mode is enabled
  if (!CONFIG.useConcatPrompt && systemPrompt) {
    modelConfig.systemInstruction = systemPrompt;
  }

  return genAI.getGenerativeModel(modelConfig);
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
async function callGemini(systemPrompt, userPrompt) {
  const model = initGemini(systemPrompt);
  
  // Build the prompt based on mode
  const prompt = CONFIG.useConcatPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  let lastError;
  
  // Try up to 2 times (initial + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      return typeof text === 'string' ? text.trim() : '';
    } catch (error) {
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
  }
  
  // Should not reach here, but just in case
  throw new Error(ERR.API_ERROR(lastError));
}

/**
 * Command: Initial review from Gemini.
 */
async function cmdReview(context, reviewType) {
  console.log('📝 Getting initial review from Gemini...\n');

  const userMessage = `Please review the following ${reviewType}:

---

${context}

---

Provide your peer review following the structure in your instructions.`;

  const response = await callGemini(PROMPTS.reviewer, userMessage);

  console.log('--- Gemini Review ---\n');
  console.log(response);
  console.log('\n--- End Review ---');

  return response;
}

/**
 * Command: Get Gemini's response to Claude's feedback.
 */
async function cmdRespond(context, debateHistory) {
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

  const response = await callGemini(PROMPTS.debateFollowup, userMessage);

  console.log('--- Gemini Response ---\n');
  console.log(response);
  console.log('\n--- End Response ---');

  return response;
}

/**
 * Command: Generate final summary.
 */
async function cmdSummary(context, debateHistory) {
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

  const response = await callGemini(PROMPTS.summary, userMessage);

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

  try {
    switch (args.command) {
      case 'review': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        const context = readFile(args.contextFile);
        await cmdReview(context, args.reviewType);
        break;
      }

      case 'respond': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        if (!args.debateFile) {
          throw new Error(ERR.MISSING_ARG('--debate-file'));
        }
        const context = readFile(args.contextFile);
        const debate = readFile(args.debateFile);
        await cmdRespond(context, debate);
        break;
      }

      case 'summary': {
        if (!args.contextFile) {
          throw new Error(ERR.MISSING_ARG('--context-file'));
        }
        if (!args.debateFile) {
          throw new Error(ERR.MISSING_ARG('--debate-file'));
        }
        const context = readFile(args.contextFile);
        const debate = readFile(args.debateFile);
        await cmdSummary(context, debate);
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
