"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshDetail() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <span className="tooltip"><button type="button" className="icon-button refresh-dashboard" aria-label="Refresh endpoint" disabled={pending}
    onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} className={pending ? "spin" : ""} aria-hidden="true" /></button>
    <span className="tooltip-text" role="tooltip">Refresh endpoint</span></span>;
}
