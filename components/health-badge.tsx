import { AlertCircle, CheckCircle2, Circle, Clock3 } from "lucide-react";
import type { HealthState } from "../server/dashboard/types";

export const healthLabels: Record<HealthState, string> = { UP: "Up", DOWN: "Down", PENDING: "Pending", STALE: "Stale", DISABLED: "Disabled", UNKNOWN: "Unknown" };

export function HealthBadge({ health }: { health: HealthState }) {
  const Icon = health === "UP" ? CheckCircle2 : health === "DOWN" ? AlertCircle : health === "STALE" ? Clock3 : Circle;
  return <span className={`health-badge health-${health.toLowerCase()}`}><Icon size={13} aria-hidden="true" />{healthLabels[health]}</span>;
}
