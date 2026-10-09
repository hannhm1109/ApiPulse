import "server-only";
import { parseTargetUrl, TargetUrlError } from "../monitoring/target-url";

export const DEMO_KINDS = ["healthy", "slow", "recovery"] as const;
export type DemoKind = typeof DEMO_KINDS[number];
export const DEMO_ENDPOINT_IDS = DEMO_KINDS.map(kind => `demo-${kind}`);

export function getDemoOrigin(): string {
  try {
    const url = parseTargetUrl(process.env.DEMO_BASE_URL ?? "");
    if (url.protocol !== "https:" || url.port || url.pathname !== "/" || url.search) throw new Error();
    return url.origin;
  } catch {
    throw new Error("DEMO_BASE_URL must be a public HTTPS origin without credentials, path, query or port.");
  }
}

export function assertDemoTarget(url: URL): void {
  if (url.origin !== getDemoOrigin() || url.search || url.hash ||
    !DEMO_KINDS.some(kind => url.pathname === `/api/demo/${kind}`)) {
    throw new TargetUrlError("Public demo monitoring is restricted to its configured demo services");
  }
}
