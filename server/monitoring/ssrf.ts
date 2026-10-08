import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export class TargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetUrlError";
  }
}

export function isPublicAddress(address: string): boolean {
  if (!isIP(address)) return false;
  return ipaddr.process(address).range() === "unicast";
}

export async function validateTargetUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetUrlError("Invalid endpoint URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetUrlError("Only HTTP and HTTPS targets are allowed");
  }
  if (url.username || url.password) {
    throw new TargetUrlError("URLs containing credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (!isIP(hostname) && !hostname.includes("."))
  ) {
    throw new TargetUrlError("Local targets are not allowed");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new TargetUrlError("Target must resolve only to public IP addresses");
  }

  return url;
}
