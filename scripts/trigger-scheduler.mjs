import { pathToFileURL } from "node:url";

export function deploymentOrigin(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error("DEMO_BASE_URL must be an HTTPS origin without credentials, path, query or port.");
  }
}

export function schedulerSummary(value) {
  const fields = ["claimed", "success", "failure", "timeout", "skipped", "errors"];
  if (!value || typeof value !== "object" || fields.some(field => !Number.isSafeInteger(value[field]) || value[field] < 0) ||
    value.claimed !== value.success + value.failure + value.timeout + value.skipped + value.errors || value.claimed > 20) {
    throw new Error("Scheduler returned an invalid summary");
  }
  return Object.fromEntries(fields.map(field => [field, value[field]]));
}

export async function triggerScheduler(origin, secret) {
  if (typeof secret !== "string" || secret.trim().length < 16 || /[\r\n]/.test(secret)) {
    throw new Error("Configure a cron secret of at least 16 characters");
  }
  const response = await fetch(`${deploymentOrigin(origin)}/api/cron/checks`, {
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(195_000),
  });
  if (!response.ok) throw new Error(`Scheduler request failed with HTTP ${response.status}`);
  const summary = schedulerSummary(await response.json());
  if (summary.errors) throw new Error("Scheduler reported internal errors");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  triggerScheduler(process.env.DEMO_BASE_URL, process.env.CRON_SECRET)
    .then(summary => console.info(JSON.stringify({ event: "remote_scheduler_finished", ...summary })))
    .catch(() => { console.error("Remote scheduler failed. Verify deployment health, authorization and server logs."); process.exitCode = 1; });
}
