import "dotenv/config";
import { pathToFileURL } from "node:url";
import { deploymentOrigin, triggerScheduler } from "./trigger-scheduler.mjs";

export async function smokeDeployment(baseUrl: string | undefined, options: { runChecks?: boolean; secret?: string } = {}) {
  const origin = deploymentOrigin(baseUrl);
  const get = (path: string) => fetch(`${origin}${path}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const health = await get("/api/health");
  if (health.status !== 200 || (await health.json()).mode !== "demo") throw new Error("Demo readiness failed");
  for (const path of ["/", "/dashboard", "/endpoints/demo-healthy", "/endpoints/demo-slow", "/endpoints/demo-recovery"]) {
    const response = await get(path);
    const body = await response.text();
    if (response.status !== 200 || !body.includes("API Pulse") || body.includes("Could not load") ||
      response.headers.get("x-frame-options") !== "DENY") throw new Error("Page smoke failed");
    const names = path.endsWith("demo-healthy") ? ["Healthy"] : path.endsWith("demo-slow") ? ["Slow"] :
      path.endsWith("demo-recovery") ? ["Recovery"] : ["Healthy", "Slow", "Recovery"];
    if (names.some(name => !body.includes(`Demo ${name} API`))) throw new Error("Demo endpoint configuration is missing");
  }
  for (const path of ["/endpoints/new", "/endpoints/demo-healthy/edit"]) {
    if ((await get(path)).status !== 404) throw new Error("Management route is accessible");
  }
  const write = await fetch(`${origin}/`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (write.status !== 403) throw new Error("Management writes are accessible");
  if ((await get("/api/cron/checks")).status !== 401) throw new Error("Cron does not reject anonymous requests");
  for (const kind of ["healthy", "slow", "recovery"]) {
    const response = await get(`/api/demo/${kind}`);
    const body = await response.json();
    if (![200, ...(kind === "recovery" ? [503] : [])].includes(response.status) ||
      response.headers.get("cache-control") !== "no-store" || body.demo !== true || body.service !== kind) throw new Error("Demo target smoke failed");
  }
  if (options.runChecks) return triggerScheduler(origin, options.secret);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--run-checks") || args.length > 1) throw new Error("Invalid smoke arguments");
  const summary = await smokeDeployment(process.env.DEMO_BASE_URL, {
    runChecks: args.includes("--run-checks"), secret: process.env.CRON_SECRET,
  });
  if (summary) console.info(JSON.stringify({ event: "smoke_scheduler_finished", ...summary }));
  console.info("Deployment smoke passed: readiness, pages, demo targets, read-only access and cron authorization.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Deployment smoke failed. Verify environment, migrations and server logs."); process.exitCode = 1; });
}
