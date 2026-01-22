/**
 * POST /api/review
 *
 * Accepts { prompt: string }. Validates (non-empty, ≤10k chars), then:
 * 1. Fetches Claude + GPT responses in parallel.
 * 2. Fetches Claude critique of GPT + GPT critique of Claude in parallel.
 * 3. Fetches Claude summary of both critiques + unbiased takeaway.
 *
 * Fail-fast: on any error, returns 5xx with user-friendly message.
 * Keys from process.env (ANTHROPIC_API_KEY, OPENAI_API_KEY); server-side only.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  INITIAL_SYSTEM,
  initialUser,
  CRITIQUE_SYSTEM,
  critiqueUserClaudeOfGpt,
  critiqueUserGptOfClaude,
  SUMMARY_SYSTEM,
  summaryUser,
} from "@/lib/prompts";
import type { ReviewResult } from "@/lib/types";

const PROMPT_MAX_CHARS = 10_000;
const CLAUDE_MODEL = "claude-sonnet-4-5";
const GPT_MODEL = "gpt-5.2";

/** User-friendly error messages for known failure modes. */
const ERR = {
  MISSING_KEY: "Missing API keys. Add ANTHROPIC_API_KEY and OPENAI_API_KEY to .env.local.",
  INVALID_JSON: "Invalid request body. Send JSON with a `prompt` string.",
  INVALID_PROMPT_EMPTY: "Please enter a non-empty prompt.",
  INVALID_PROMPT_LONG: `Prompt must be ${PROMPT_MAX_CHARS.toLocaleString()} characters or fewer.`,
  CLAUDE: "Unable to connect to Claude. Please check your API key and try again.",
  GPT: "Unable to connect to GPT. Please check your API key and try again.",
  GENERIC: "Something went wrong. Please try again.",
} as const;

type ReviewPayload = { prompt: string };

function ensureApiKeys(): { anthropic: Anthropic; openai: OpenAI } {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!anthropicKey || !openaiKey) throw new Error(ERR.MISSING_KEY);
  return {
    anthropic: new Anthropic({ apiKey: anthropicKey }),
    openai: new OpenAI({ apiKey: openaiKey }),
  };
}

/** Extract text from Anthropic message content (array of blocks). */
function anthropicText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type: string }).type === "text" &&
      "text" in block &&
      typeof (block as { text: string }).text === "string"
    )
      parts.push((block as { text: string }).text);
  }
  return parts.join("\n\n").trim() || "";
}

/** Call Claude; throw with user-friendly message on failure. */
async function callClaude(
  client: Anthropic,
  system: string,
  userMessage: string
): Promise<string> {
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    return anthropicText(msg.content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/api_key|401|403|invalid/i.test(msg)) throw new Error(ERR.CLAUDE);
    throw new Error(ERR.CLAUDE);
  }
}

/** Call GPT; throw with user-friendly message on failure. */
async function callGpt(
  client: OpenAI,
  system: string,
  userMessage: string
): Promise<string> {
  try {
    const comp = await client.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    });
    const text = comp.choices[0]?.message?.content;
    return typeof text === "string" ? text.trim() : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/api_key|401|403|invalid/i.test(msg)) throw new Error(ERR.GPT);
    throw new Error(ERR.GPT);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: ERR.INVALID_JSON }, { status: 400 });
    }
    const prompt =
      body && typeof body === "object" && "prompt" in body && typeof (body as ReviewPayload).prompt === "string"
        ? (body as ReviewPayload).prompt.trim()
        : "";

    if (!prompt) {
      return Response.json(
        { error: ERR.INVALID_PROMPT_EMPTY },
        { status: 400 }
      );
    }
    if (prompt.length > PROMPT_MAX_CHARS) {
      return Response.json(
        { error: ERR.INVALID_PROMPT_LONG },
        { status: 400 }
      );
    }

    const { anthropic, openai } = ensureApiKeys();
    const userPrompt = initialUser(prompt);

    const [claudeResponse, gptResponse] = await Promise.all([
      callClaude(anthropic, INITIAL_SYSTEM, userPrompt),
      callGpt(openai, INITIAL_SYSTEM, userPrompt),
    ]);

    const [claudeCritiqueOfGpt, gptCritiqueOfClaude] = await Promise.all([
      callClaude(
        anthropic,
        CRITIQUE_SYSTEM,
        critiqueUserClaudeOfGpt(prompt, gptResponse)
      ),
      callGpt(
        openai,
        CRITIQUE_SYSTEM,
        critiqueUserGptOfClaude(prompt, claudeResponse)
      ),
    ]);

    const summary = await callClaude(
      anthropic,
      SUMMARY_SYSTEM,
      summaryUser(claudeCritiqueOfGpt, gptCritiqueOfClaude)
    );

    const result: ReviewResult = {
      prompt,
      claudeResponse,
      gptResponse,
      claudeCritiqueOfGpt,
      gptCritiqueOfClaude,
      summary,
    };

    return Response.json(result);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(ERR.GENERIC);
    const message = err.message;
    const isKnown =
      message === ERR.MISSING_KEY ||
      message === ERR.CLAUDE ||
      message === ERR.GPT;

    return Response.json(
      { error: isKnown ? message : ERR.GENERIC },
      { status: 500 }
    );
  }
}
