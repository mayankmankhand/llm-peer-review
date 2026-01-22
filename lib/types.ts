/**
 * Shared types for LLM peer review API and UI.
 */

export type ReviewResult = {
  prompt: string;
  claudeResponse: string;
  gptResponse: string;
  claudeCritiqueOfGpt: string;
  gptCritiqueOfClaude: string;
  summary: string;
};

const REVIEW_KEYS: (keyof ReviewResult)[] = [
  "prompt",
  "claudeResponse",
  "gptResponse",
  "claudeCritiqueOfGpt",
  "gptCritiqueOfClaude",
  "summary",
];

/** Runtime check that a value is a valid ReviewResult. */
export function isReviewResult(value: unknown): value is ReviewResult {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return REVIEW_KEYS.every((k) => typeof o[k] === "string");
}
