"use client";

import { useState, useCallback, useRef } from "react";
import CopyableSection from "./components/CopyableSection";
import { isReviewResult, type ReviewResult } from "@/lib/types";

const PROMPT_MAX_CHARS = 10_000;

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const overLimit = prompt.length > PROMPT_MAX_CHARS;
  const isEmpty = !prompt.trim();
  const canSubmit = !isEmpty && !overLimit && !loading;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setError(null);
      setLoading(true);
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Something went wrong. Please try again.");
          return;
        }
        if (!isReviewResult(data)) {
          setError("Invalid response from server. Please try again.");
          return;
        }
        setResult(data);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [canSubmit, prompt]
  );

  const handleStartNew = useCallback(() => {
    setPrompt("");
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)] max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          LLM Peer Review
        </h1>
        <p className="text-sm text-[var(--foreground)]/70 mt-1">
          Enter a prompt. Claude and GPT respond, critique each other, then
          Claude summarizes.
        </p>
      </header>

      {result && (
        <section
          className="mb-12 pb-8 border-b border-black/10 dark:border-white/10"
          aria-label="Review results"
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Review complete
            </h2>
            <button
              type="button"
              onClick={handleStartNew}
              className="text-sm font-medium text-[var(--foreground)]/70 hover:text-[var(--foreground)] px-4 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/[.04] dark:hover:bg-white/[.04] transition-colors"
            >
              Start new review
            </button>
          </div>

          <CopyableSection title="Prompt" text={result.prompt} />

          <div className="grid grid-cols-2 gap-6 mt-6">
            <CopyableSection
              title="Claude"
              text={result.claudeResponse}
            />
            <CopyableSection
              title="GPT"
              text={result.gptResponse}
            />
          </div>

          <div className="mt-6 space-y-4">
            <CopyableSection
              title="Claude's critique of GPT"
              text={result.claudeCritiqueOfGpt}
            />
            <CopyableSection
              title="GPT's critique of Claude"
              text={result.gptCritiqueOfClaude}
            />
            <CopyableSection
              title="Summary & takeaway"
              text={result.summary}
            />
          </div>
        </section>
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label="New review form"
      >
        <div>
          <label
            htmlFor="prompt"
            className="block text-sm font-medium text-[var(--foreground)] mb-2"
          >
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={PROMPT_MAX_CHARS}
            placeholder="Enter your prompt…"
            disabled={loading}
            rows={6}
            className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-[var(--background)] text-[var(--foreground)] px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]/20 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between items-center">
            <span
              className={`text-sm ${overLimit
                  ? "text-red-600 dark:text-red-400"
                  : "text-[var(--foreground)]/60"
                }`}
            >
              {prompt.length.toLocaleString()} /{" "}
              {PROMPT_MAX_CHARS.toLocaleString()}
            </span>
            {overLimit && (
              <span className="text-sm text-red-600 dark:text-red-400">
                Prompt must be {PROMPT_MAX_CHARS.toLocaleString()} characters or
                fewer.
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--foreground)] text-[var(--background)] px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? "Reviewing…" : "Run review"}
          </button>
          {loading && (
            <span
              className="inline-block w-5 h-5 border-2 border-[var(--foreground)]/30 border-t-[var(--foreground)] rounded-full animate-spin"
              aria-hidden
            />
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
