import "server-only";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import type { ValidatedTarget } from "./ssrf";
import { normalizeHostname, targetHostname, TargetUrlError } from "./target-url";

export function createPinnedLookup(target: ValidatedTarget): LookupFunction {
  const hostname = targetHostname(target.url);
  const address = { ...target.address };
  return (requestedHostname, options, callback) => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      callback(new TargetUrlError("Connection hostname differs from validated target"), "");
      return;
    }
    callback(null, options.all ? [address] : address.address, address.family);
  };
}

export function createTargetDispatcher(target: ValidatedTarget, timeoutMs: number) {
  // Keep the URL hostname for Host/SNI and certificate verification, but never resolve it a second time.
  return new Agent({
    connections: 1, pipelining: 0, allowH2: false, autoSelectFamily: false,
    connect: { lookup: createPinnedLookup(target), timeout: timeoutMs, rejectUnauthorized: true },
  });
}
