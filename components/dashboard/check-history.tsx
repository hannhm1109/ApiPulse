import type { DashboardCheck } from "../../server/dashboard/types";

export function CheckHistory({ checks }: { checks: DashboardCheck[] }) {
  if (!checks.length) return <span className="muted">No checks</span>;
  return <ol className="check-history" aria-label="Recent check results, oldest to newest">
    {[...checks].reverse().map(check => {
      const label = [check.status, check.checkedAt, check.statusCode == null ? null : `HTTP ${check.statusCode}`, check.failureReason].filter(Boolean).join(" | ");
      return <li key={check.id}><span className={`check-mark check-${check.status.toLowerCase()}`} role="img" aria-label={label} title={label} /></li>;
    })}
  </ol>;
}
