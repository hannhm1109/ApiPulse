"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyUrl({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  const message = state === "copied" ? "URL copied" : state === "failed" ? "Could not copy URL" : "Copy endpoint URL";
  return <span className="tooltip">
    <button type="button" className="icon-button copy-url" aria-label="Copy endpoint URL" onClick={copy}>
      {state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
    <span className="tooltip-text" role="tooltip">{message}</span>
    <span className="sr-only" role="status">{state === "idle" ? "" : message}</span>
  </span>;
}
