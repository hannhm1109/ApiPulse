"use client";

import { useState, useTransition } from "react";
import { setEndpointEnabledAction } from "../../app/endpoints/actions";

export function MonitoringSwitch({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function change(desired: boolean) {
    setError("");
    startTransition(async () => {
      try {
        const result = await setEndpointEnabledAction(id, desired);
        if (!result.ok) setError(result.message);
      } catch {
        setError("Could not change monitoring. Please try again.");
      }
    });
  }
  return (
    <div className="monitoring-control" aria-busy={pending}>
      <label className="monitoring-toggle">
        <span className="switch"><input type="checkbox" role="switch" aria-label={`Monitoring for ${name}`}
          checked={enabled} disabled={pending} onChange={event => change(event.target.checked)} />
          <span className="switch-track" aria-hidden="true"><span /></span>
        </span>
        <span className={enabled ? "monitoring-enabled" : "muted"}>{pending ? "Saving..." : enabled ? "Enabled" : "Disabled"}</span>
      </label>
      {error && <p className="field-error toggle-error" role="alert">{error}</p>}
    </div>
  );
}
