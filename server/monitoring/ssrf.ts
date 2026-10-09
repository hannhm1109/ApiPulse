import "server-only";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { isPublicAddress, parseTargetUrl, targetHostname, TargetUrlError } from "./target-url";
export { isPublicAddress, TargetUrlError } from "./target-url";

export type ValidatedTarget = { url: URL; address: LookupAddress };

export async function validateTargetUrl(rawUrl: string): Promise<ValidatedTarget> {
  const url = parseTargetUrl(rawUrl);
  const hostname = targetHostname(url);

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new TargetUrlError("Target must resolve only to public IP addresses");
  }

  // A single validated address is pinned for this attempt; there is no fallback DNS lookup or retry.
  return { url, address: addresses.find(address => address.family === 4) ?? addresses[0] };
}
