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
    "168.63.129.16", "::ffff:168.63.129.16", "198.18.0.1", "192.0.2.1", "203.0.113.1",
    "2001:db8::1", "64:ff9b::7f00:1", "2002:7f00:1::", "fec0::1",
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
    "http://168.63.129.16", "http://[::ffff:168.63.129.16]", "https://example.com/#fragment",
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
    const target = await validateTargetUrl("https://example.com/health");
    expect(target.url.href).toBe("https://example.com/health");
    expect(target.address).toEqual({ address: "8.8.8.8", family: 4 });
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it("rejects an empty DNS answer", async () => {
    lookupMock.mockResolvedValue([]);
    await expect(validateTargetUrl("https://example.com")).rejects.toThrow("public IP");
  });
  it("rejects mixed IPv4/IPv6 answers containing a private destination", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "fd00::1", family: 6 }]);
    await expect(validateTargetUrl("https://example.com")).rejects.toThrow("public IP");
  });
  it("pins one public IPv4 answer without another DNS resolution", async () => {
    lookupMock.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 }]);
    expect((await validateTargetUrl("https://example.com")).address).toEqual({ address: "8.8.8.8", family: 4 });
    expect(lookupMock).toHaveBeenCalledOnce();
  });
  it("supports IPv6-only public targets", async () => {
    lookupMock.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    expect((await validateTargetUrl("https://example.com")).address.family).toBe(6);
  });
  it("validates literal public addresses without DNS", async () => {
    expect((await validateTargetUrl("https://8.8.8.8")).address).toEqual({ address: "8.8.8.8", family: 4 });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
