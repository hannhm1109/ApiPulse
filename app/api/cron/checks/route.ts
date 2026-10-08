import { timingSafeEqual } from "node:crypto";
import { runScheduler } from "../../../../server/monitoring/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim().length < 16) {
    return json({ error: "Scheduler secret is not configured" }, 503);
  }
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { prisma } = await import("../../../../server/db/prisma");
    const summary = await runScheduler(prisma);
    return json(summary, summary.errors > 0 ? 503 : 200);
  } catch (error) {
    console.error(JSON.stringify({ event: "scheduler_failed", error: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "Scheduler execution failed" }, 503);
  }
}
