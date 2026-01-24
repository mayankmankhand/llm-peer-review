#!/usr/bin/env node

/**
 * Dev Lead - Automated AI Peer Review Script
 * 
 * Handles ChatGPT API calls for the peer review debate.
 * Claude (in Cursor) orchestrates the flow and provides responses.
 * 
 * Commands:
 *   review   - Get initial review from ChatGPT
 *   respond  - Get ChatGPT's response to Claude's feedback
 *   summary  - Generate final debate summary
 * 
 * Usage:
 *   node scripts/dev-lead.js review --context-file <path> [--review-type <type>]
 *   node scripts/dev-lead.js respond --context-file <path> --debate-file <path>
 *   node scripts/dev-lead.js summary --context-file <path> --debate-file <path>
 * 
 * Environment:
 *   OPENAI_API_KEY   Required for ChatGPT API calls
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

// Configuration
const CONFIG = {
  model: process.env.GPT_MODEL || 'gpt-4o',
  maxTokens: 4096,
  timeout: 120000, // 2 minutes
};

// Error messages
const ERR = {
  MISSING_KEY: 'OPENAI_API_KEY not found. Add it to .env.local',
  MISSING_ARG: (arg) => `Missing required argument: ${arg}`,
  FILE_NOT_FOUND: (f) => `File not found: ${f}`,
  API_ERROR: (msg) => `OpenAI API error: ${msg}`,
  UNKNOWN_CMD: (cmd) => `Unknown command: ${cmd}. Use review, respond, or summary.`,
};

// Prompt templates
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

  summary: `You are summarizing a peer review debate between two engineers (ChatGPT as Reviewer, Claude as Author). Produce a clear, actionable summary.

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
        parsed.contextFile = args[++i];
        break;
      case '--debate-file':
        parsed.debateFile = args[++i];
        break;
      case '--review-type':
        parsed.reviewType = args[++i];
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
Dev Lead - Automated AI Peer Review

Commands:
  review    Get initial review from ChatGPT
  respond   Get ChatGPT's response to Claude's feedback  
  summary   Generate final debate summary

Usage:
  node scripts/dev-lead.js review --context-file <path> [--review-type <type>]
  node scripts/dev-lead.js respond --context-file <path> --debate-file <path>
  node scripts/dev-lead.js summary --context-file <path> --debate-file <path>

Options:
  --context-file   Path to file with content to review (required)
  --debate-file    Path to file with debate history (for respond/summary)
  --review-type    Type: plan, code, branch, feature (default: code)
  --help           Show this help message

Environment:
  OPENAI_API_KEY   Required for ChatGPT API calls

Examples:
  # Initial review
  node scripts/dev-lead.js review --context-file context.md --review-type plan

  # After Claude responds, get ChatGPT's follow-up
  node scripts/dev-lead.js respond --context-file context.md --debate-file debate.md

  # Generate final summary
  node scripts/dev-lead.js summary --context-file context.md --debate-file debate.md
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
 * Initialize OpenAI client.
 */
function initOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(ERR.MISSING_KEY);
  }

  const OpenAI = require('openai').default;
  return new OpenAI({
    apiKey,
    maxRetries: 0,
  });
}

/**
 * Call ChatGPT with the given prompts.
 */
async function callChatGPT(client, system, user) {
  try {
    const response = await client.chat.completions.create(
      {
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { timeout: CONFIG.timeout }
    );

    const text = response.choices[0]?.message?.content;
    return typeof text === 'string' ? text.trim() : '';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/timeout|timed out|ETIMEDOUT|aborted/i.test(msg)) {
      throw new Error('Request timed out. Try again.');
    }
    throw new Error(ERR.API_ERROR(msg));
  }
}

/**
 * Command: Initial review from ChatGPT.
 */
async function cmdReview(client, context, reviewType) {
  console.log('📝 Getting initial review from ChatGPT...\n');

  const userMessage = `Please review the following ${reviewType}:

---

${context}

---

Provide your peer review following the structure in your instructions.`;

  const response = await callChatGPT(client, PROMPTS.reviewer, userMessage);

  console.log('--- ChatGPT Review ---\n');
  console.log(response);
  console.log('\n--- End Review ---');

  return response;
}

/**
 * Command: Get ChatGPT's response to Claude's feedback.
 */
async function cmdRespond(client, context, debateHistory) {
  console.log('🔄 Getting ChatGPT response to Claude...\n');

  const userMessage = `Original content under review:

---

${context}

---

Debate so far:

---

${debateHistory}

---

Continue the peer review discussion. Respond to the author's latest points following the structure in your instructions.`;

  const response = await callChatGPT(client, PROMPTS.debateFollowup, userMessage);

  console.log('--- ChatGPT Response ---\n');
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

  const response = await callChatGPT(client, PROMPTS.summary, userMessage);

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
    const client = initOpenAI();

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
