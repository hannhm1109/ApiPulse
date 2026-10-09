import "server-only";
import type { DemoKind } from "./config";

export const DEMO_CYCLE_MS = 30 * 60_000;
export const DEMO_FAILURE_MS = 10 * 60_000;

export function demoObservation(kind: DemoKind, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Demo clock must be valid");
  const phase = ((now.getTime() % DEMO_CYCLE_MS) + DEMO_CYCLE_MS) % DEMO_CYCLE_MS;
  return {
    statusCode: kind === "recovery" && phase < DEMO_FAILURE_MS ? 503 : 200,
    delayMs: kind === "slow" ? 750 : kind === "recovery" ? 100 : 0,
  };
}
