import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress, parseTargetUrl, targetHostname, TargetUrlError } from "./target-url";
export { isPublicAddress, TargetUrlError } from "./target-url";

export async function validateTargetUrl(rawUrl: string): Promise<URL> {
  const url = parseTargetUrl(rawUrl);
  const hostname = targetHostname(url);

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new TargetUrlError("Target must resolve only to public IP addresses");
  }

  return url;
}
