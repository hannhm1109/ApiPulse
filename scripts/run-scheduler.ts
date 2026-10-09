import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { createPrismaClient } from "../server/db/client";
import { runScheduler } from "../server/monitoring/scheduler";
import { logServerError } from "../server/logging";

async function main() {
  const args = process.argv.slice(2);
  const watch = args.length === 1 && args[0] === "--watch";
  if (args.length && !watch) throw new Error("Usage: npm run checks:run [-- --watch]");
  const db = createPrismaClient();
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    do {
      try {
        const result = await runScheduler(db);
        if (!watch && result.errors) process.exitCode = 1;
      } catch (error) {
        logServerError("scheduler_runner_tick_error", error);
        if (!watch) process.exitCode = 1;
      }
      if (!watch || stop.signal.aborted) break;
      try {
        await delay(60_000 - Date.now() % 60_000, undefined, { signal: stop.signal });
      } catch (error) {
        if (!stop.signal.aborted) throw error;
      }
    } while (!stop.signal.aborted);
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  logServerError("scheduler_runner_error", error);
  process.exitCode = 1;
});
