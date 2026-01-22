"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type Props = {
  title: string;
  text: string;
};

/** Delay (ms) before clearing "Copied" state. */
const COPIED_RESET_MS = 2000;

/**
 * Renders a section with a title and body. Includes a "Copy" button
 * that copies the body to clipboard and shows brief feedback.
 */
export default function CopyableSection({ title, text }: Props) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCopied(true);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setCopied(false);
      }, COPIED_RESET_MS);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/10 bg-[var(--background)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b border-black/10 dark:border-white/10 bg-black/[.02] dark:bg-white/[.02]">
        <h3 className="text-sm font-medium text-[var(--foreground)]">{title}</h3>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs font-medium text-[var(--foreground)]/70 hover:text-[var(--foreground)] px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/[.04] dark:hover:bg-white/[.04] transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="p-4 text-sm text-[var(--foreground)] whitespace-pre-wrap">
        {text}
      </div>
    </section>
  );
}
