import { setTimeout as delay } from "node:timers/promises";
import { DEMO_KINDS, type DemoKind } from "../../../../server/demo/config";
import { demoObservation } from "../../../../server/demo/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const headers = { "Cache-Control": "no-store", "X-API-Pulse-Demo": "true" };
  if (!DEMO_KINDS.includes(kind as DemoKind)) return Response.json({ error: "Not found" }, { status: 404, headers });
  const now = new Date();
  const { statusCode, delayMs } = demoObservation(kind as DemoKind, now);
  if (delayMs) await delay(delayMs);
  return Response.json({ demo: true, service: kind, status: statusCode === 200 ? "healthy" : "unhealthy", observedAt: now.toISOString() },
    { status: statusCode, headers });
}
