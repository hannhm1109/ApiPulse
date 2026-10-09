import "server-only";
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
  const parsed = ipaddr.process(address);
  // Azure's platform virtual address is globally numbered but exposes host infrastructure inside Azure.
  return parsed.range() === "unicast" && parsed.toString() !== "168.63.129.16";
}

// Shared by configuration validation and execution; DNS is checked separately at execution time.
export function parseTargetUrl(rawUrl: string): URL {
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
  if (url.hash) throw new TargetUrlError("Remove the URL fragment; it is not sent to the server.");
  const hostname = targetHostname(url);
  if (
    !hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    (!isIP(hostname) && !hostname.includes("."))
  ) {
    throw new TargetUrlError("Local targets are not allowed");
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new TargetUrlError("Target must resolve only to public IP addresses");
  }
  return url;
}

export function targetHostname(url: URL): string {
  return normalizeHostname(url.hostname);
}

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}
