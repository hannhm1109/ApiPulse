import { isReadOnlyDeployment } from "../../../server/deployment";
import { getDemoOrigin } from "../../../server/demo/config";
import { logServerError } from "../../../server/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (isReadOnlyDeployment()) getDemoOrigin();
    const { prisma } = await import("../../../server/db/prisma");
    const [settings] = await prisma.$queryRaw<{ statement: string; lock: string; idle: string }[]>`
      SELECT current_setting('statement_timeout') AS statement,
        current_setting('lock_timeout') AS lock,
        current_setting('idle_in_transaction_session_timeout') AS idle
    `;
    if (settings.statement !== "10s" || settings.lock !== "3s" || settings.idle !== "10s") {
      throw new Error("Database role deadlines are not configured");
    }
    await prisma.endpoint.count();
    return Response.json({ status: "ok", mode: isReadOnlyDeployment() ? "demo" : "local" }, { headers });
  } catch (error) {
    logServerError("readiness_error", error);
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
