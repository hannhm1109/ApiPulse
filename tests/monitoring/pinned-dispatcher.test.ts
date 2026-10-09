import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup, createTargetDispatcher } from "../../server/monitoring/pinned-dispatcher";

describe("validated connection pinning", () => {
  const target = () => ({ url: new URL("https://Example.com./health"), address: { address: "8.8.8.8", family: 4 } });
  it("returns the validated address, including all-address lookup requests, without system DNS", () => {
    const lookup = createPinnedLookup(target());
    const callback = vi.fn();
    lookup("example.com.", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "8.8.8.8", 4);
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: "8.8.8.8", family: 4 }], 4);
  });
  it("copies the address before asynchronous connection so mutation cannot replace its validated destination", () => {
    const resolved = target();
    const lookup = createPinnedLookup(resolved);
    resolved.address.address = "127.0.0.1";
    const callback = vi.fn();
    lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });
  it("refuses a different hostname instead of resolving it", () => {
    const callback = vi.fn();
    createPinnedLookup(target())("attacker.example", {}, callback);
    expect(callback.mock.calls[0][0]).toMatchObject({ name: "TargetUrlError" });
    expect(callback.mock.calls[0][1]).toBe("");
  });
  it("supports pinned IPv6 lookup answers", () => {
    const callback = vi.fn();
    createPinnedLookup({ ...target(), address: { address: "2606:4700:4700::1111", family: 6 } })("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "2606:4700:4700::1111", 6);
  });
  it("creates a disposable request-scoped agent, not a global proxy or shared pool", async () => {
    const first = createTargetDispatcher(target(), 1000);
    const second = createTargetDispatcher(target(), 1000);
    expect(first).not.toBe(second);
    await Promise.all([first.destroy(), second.destroy()]);
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(true);
  });
});
