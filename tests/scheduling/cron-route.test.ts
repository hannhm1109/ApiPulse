import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/cron/checks/route";
import { runScheduler } from "../../server/monitoring/scheduler";

vi.mock("../../server/db/prisma", () => ({ prisma: {} }));
vi.mock("../../server/monitoring/scheduler", () => ({ runScheduler: vi.fn() }));

describe("protected scheduler route", () => {
  const secret = "test-secret-not-for-deployment";
  const summary = { claimed: 1, success: 0, failure: 1, timeout: 0, skipped: 0, errors: 0 };
  const request = (authorization?: string) => new Request("http://localhost/api/cron/checks", {
    headers: authorization ? { authorization } : {},
  });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.mocked(runScheduler).mockReset().mockResolvedValue(summary);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "short"])("fails closed for missing or short secret configuration", async value => {
    vi.stubEnv("CRON_SECRET", value);
    expect((await GET(request(`Bearer ${value}`))).status).toBe(503);
    expect(runScheduler).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer undefined", "Basic test", "Bearer wrong-secret-not-for-use"])(
    "rejects an invalid authorization header %s", async header => {
      expect((await GET(request(header))).status).toBe(401);
      expect(runScheduler).not.toHaveBeenCalled();
    },
  );
  it("returns observed target failures as a successful scheduler response", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(summary);
    expect(runScheduler).toHaveBeenCalledOnce();
  });
  it("returns partial results with 503 if an internal endpoint error occurred", async () => {
    vi.mocked(runScheduler).mockResolvedValue({ ...summary, errors: 1, claimed: 2 });
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ errors: 1, failure: 1 });
  });
  it("keeps internal database errors out of the response", async () => {
    vi.mocked(runScheduler).mockRejectedValue(new Error("Sensitive internal database detail"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Scheduler execution failed" });
  });
});
