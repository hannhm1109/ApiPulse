import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { isPublicAddress, validateTargetUrl } from "../../server/monitoring/ssrf";

const lookupMock = vi.hoisted(() => vi.fn<
  (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>
>());

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

describe("target validation", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it.each([
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::",
    "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "not-an-ip",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "accepts public address %s", (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    "invalid", "file:///etc/passwd", "ftp://example.com", "http://user:secret@example.com",
    "http://localhost", "http://localhost.", "http://api.localhost", "http://api.local",
    "http://api.internal", "http://metadata", "http://127.0.0.1", "http://2130706433",
    "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]",
  ])("blocks dangerous URL %s without DNS lookup", async (url) => {
    await expect(validateTargetUrl(url)).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("requires every resolved address to be public", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(validateTargetUrl("https://example.com/health")).rejects.toThrow("public IP");
  });

  it("accepts a public hostname after checking its addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const url = await validateTargetUrl("https://example.com/health");
    expect(url.href).toBe("https://example.com/health");
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it("rejects an empty DNS answer", async () => {
    lookupMock.mockResolvedValue([]);
    await expect(validateTargetUrl("https://example.com")).rejects.toThrow("public IP");
  });
});
