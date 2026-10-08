"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

export default function EndpointError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="page-container" id="main-content"><div className="empty-state error-state">
    <AlertCircle size={28} aria-hidden="true" /><h1>Could not load endpoint</h1><p>Please try again in a moment.</p>
    <button type="button" className="button button-secondary" onClick={retry}><RefreshCw size={16} aria-hidden="true" />Try again</button>
  </div></main>;
}
