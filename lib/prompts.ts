/**
 * Prompt templates for LLM peer review flow.
 * Used by /api/review: initial response, cross-critique, and summary.
 */

/** System prompt for initial response (Claude and GPT). Minimal; model just answers the user. */
export const INITIAL_SYSTEM =
  "Answer the user's question concisely and accurately. Do not preface or summarize unless asked.";

/** Build user message for initial response. */
export function initialUser(prompt: string): string {
  return prompt;
}

/** System prompt for critique: one model critiques the other's reply. */
export const CRITIQUE_SYSTEM = `You are a fair, constructive critic. Given a user prompt and another model's response, write a short critique. Focus on:
- Factual accuracy and possible hallucinations
- Logic and reasoning gaps
- Clarity and completeness
Be specific and concise. Do not be overly harsh or complimentary.`;

/** Build user message for Claude critiquing GPT's response. */
export function critiqueUserClaudeOfGpt(prompt: string, gptResponse: string): string {
  return `User prompt:\n\n${prompt}\n\n---\n\nGPT's response:\n\n${gptResponse}\n\n---\n\nCritique GPT's response (concise, constructive).`;
}

/** Build user message for GPT critiquing Claude's response. */
export function critiqueUserGptOfClaude(prompt: string, claudeResponse: string): string {
  return `User prompt:\n\n${prompt}\n\n---\n\nClaude's response:\n\n${claudeResponse}\n\n---\n\nCritique Claude's response (concise, constructive).`;
}

/** System prompt for Claude's summary of both critiques. */
export const SUMMARY_SYSTEM = `You are a neutral summarizer. You will receive two critiques: one from Claude (about GPT's response) and one from GPT (about Claude's response). Your job:
1. Summarize the main points of both critiques in a balanced way.
2. Give a single, unbiased takeaway: what should the user keep in mind when reading the two original responses?

Be brief and even-handed. Do not favor either model.`;

/** Build user message for summary. */
export function summaryUser(claudeCritique: string, gptCritique: string): string {
  return `Claude's critique of GPT's response:\n\n${claudeCritique}\n\n---\n\nGPT's critique of Claude's response:\n\n${gptCritique}\n\n---\n\nSummarize both critiques and provide one unbiased takeaway for the user.`;
}
