import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeHttpCheck } from "../../server/monitoring/execute-http-check";
import { TargetUrlError, validateTargetUrl } from "../../server/monitoring/ssrf";

vi.mock("../../server/monitoring/ssrf", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../server/monitoring/ssrf")>();
  return { ...original, validateTargetUrl: vi.fn() };
});

const endpoint = { url: "https://example.com/health", expectedStatusCode: 200, timeoutMs: 1000 };

describe("executeHttpCheck", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(validateTargetUrl).mockReset().mockResolvedValue(new URL(endpoint.url));
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("records matching status, rounded elapsed time, and observation timestamp", async () => {
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(242.6);
    fetchMock.mockResolvedValue(new Response("large body is not needed", { status: 200 }));
    const result = await executeHttpCheck(endpoint);
    expect(result).toEqual({
      checkedAt: new Date("2026-10-08T10:00:00Z"),
      responseTimeMs: 143,
      statusCode: 200,
      status: "SUCCESS",
      failureReason: null,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(new URL(endpoint.url), expect.objectContaining({
      method: "GET", cache: "no-store", redirect: "manual", signal: expect.any(AbortSignal),
    }));
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("treats HTTP 500 as an observed failure", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await executeHttpCheck(endpoint)).toMatchObject({
      status: "FAILURE", statusCode: 500,
      failureReason: "Unexpected HTTP status: 500 (expected 200)",
    });
  });

  it("evaluates redirects without following their location", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1" } }));
    expect(await executeHttpCheck(endpoint)).toMatchObject({ status: "FAILURE", statusCode: 302 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("records network rejection without retrying", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await executeHttpCheck(endpoint)).toMatchObject({
      status: "FAILURE", statusCode: null, failureReason: "Network request failed",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("records DNS failure without attempting HTTP", async () => {
    vi.mocked(validateTargetUrl).mockRejectedValue(Object.assign(new Error("DNS failed"), { code: "ENOTFOUND" }));
    expect(await executeHttpCheck(endpoint)).toMatchObject({
      status: "FAILURE", statusCode: null, failureReason: "DNS lookup failed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records blocked targets without attempting HTTP", async () => {
    vi.mocked(validateTargetUrl).mockRejectedValue(new TargetUrlError("Local targets are not allowed"));
    expect(await executeHttpCheck(endpoint)).toMatchObject({
      status: "FAILURE", statusCode: null, failureReason: "Local targets are not allowed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a hanging request at the configured deadline", async () => {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const check = executeHttpCheck(endpoint);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await check).toMatchObject({
      status: "TIMEOUT", statusCode: null, responseTimeMs: 1000,
      failureReason: "Request timed out after 1000 ms",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("times out DNS and prevents a late lookup from starting HTTP", async () => {
    let completeLookup!: (url: URL) => void;
    vi.mocked(validateTargetUrl).mockImplementation(() => new Promise(resolve => { completeLookup = resolve; }));
    const check = executeHttpCheck(endpoint);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await check).toMatchObject({ status: "TIMEOUT", statusCode: null });
    completeLookup(new URL(endpoint.url));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([Error, TypeError])("does not convert internal %s exceptions into target failures", async ErrorType => {
    const error = new ErrorType("Unexpected validator bug");
    vi.mocked(validateTargetUrl).mockRejectedValue(error);
    await expect(executeHttpCheck(endpoint)).rejects.toBe(error);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid timeout %s before HTTP", async timeoutMs => {
    await expect(executeHttpCheck({ ...endpoint, timeoutMs })).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([99, 600, 200.5, NaN])("rejects invalid expected status %s", async expectedStatusCode => {
    await expect(executeHttpCheck({ ...endpoint, expectedStatusCode })).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
