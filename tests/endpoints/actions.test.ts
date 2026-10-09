import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveEndpointAction, setEndpointEnabledAction } from "../../app/endpoints/actions";

const mocks = vi.hoisted(() => ({ save: vi.fn(), toggle: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock("../../server/db/prisma", () => ({ prisma: {} }));
vi.mock("../../server/endpoints/endpoint-service", () => ({ saveEndpoint: mocks.save, setEndpointEnabled: mocks.toggle }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("endpoint server actions", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });
  it("returns field errors without redirecting or revalidating", async () => {
    mocks.save.mockResolvedValue({ ok: false, message: "Check the highlighted fields.", errors: { name: ["Enter a name."] } });
    expect(await saveEndpointAction(null, {}, new FormData())).toEqual({ message: "Check the highlighted fields.", errors: { name: ["Enter a name."] } });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("revalidates after a save and lets redirect control flow escape", async () => {
    mocks.save.mockResolvedValue({ ok: true, id: "endpoint" });
    await expect(saveEndpointAction(null, {}, new FormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.revalidate.mock.calls).toEqual([["/"], ["/dashboard"], ["/endpoints/endpoint"], ["/endpoints/endpoint/edit"]]);
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
  it("passes the edit ID and only extracted configuration to the service", async () => {
    mocks.save.mockResolvedValue({ ok: false, message: "not found" });
    const form = new FormData();
    form.set("name", "Payments"); form.set("checkClaimToken", "tampered");
    await saveEndpointAction("endpoint", {}, form);
    expect(mocks.save).toHaveBeenCalledWith({}, expect.objectContaining({ name: "Payments", enabled: false }), "endpoint");
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty("checkClaimToken");
  });
  it("returns a generic save error without database details", async () => {
    mocks.save.mockRejectedValue(new Error("postgresql://secret:password@internal"));
    const result = await saveEndpointAction(null, {}, new FormData());
    expect(result.message).toBe("Could not save the endpoint. Please try again.");
    expect(JSON.stringify(result)).not.toContain("password");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("revalidates a successful explicit enabled change", async () => {
    mocks.toggle.mockResolvedValue({ ok: true, id: "endpoint" });
    await setEndpointEnabledAction("endpoint", false);
    expect(mocks.toggle).toHaveBeenCalledWith({}, "endpoint", false);
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard");
    expect(mocks.revalidate).toHaveBeenCalledWith("/endpoints/endpoint");
  });
  it("does not revalidate a missing endpoint", async () => {
    mocks.toggle.mockResolvedValue({ ok: false, message: "not found" });
    expect(await setEndpointEnabledAction("missing", true)).toEqual({ ok: false, message: "not found" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("returns a generic toggle error", async () => {
    mocks.toggle.mockRejectedValue(new Error("private database details"));
    expect(await setEndpointEnabledAction("endpoint", false)).toEqual({ ok: false, message: "Could not change monitoring. Please try again." });
  });
  it("blocks direct public-demo action calls before the service, revalidation or redirect", async () => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    expect(await saveEndpointAction(null, {}, new FormData())).toMatchObject({ message: expect.stringContaining("disabled") });
    expect(await setEndpointEnabledAction("demo-healthy", false)).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.toggle).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
