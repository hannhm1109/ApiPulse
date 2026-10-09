import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPageData } from "../../server/page-data";

describe("page read error boundary", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it.each([null, [], { status: "SUCCESS" }])("preserves real empty, missing and populated results", async data => {
    expect(await loadPageData("dashboard_read_error", async () => data)).toBe(data);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs a safe category and throws a new static error without exposing the original cause", async () => {
    const original = Object.assign(new Error("postgresql://user:secret@private/database"), { code: "P1001" });
    const result = loadPageData("dashboard_read_error", async () => { throw original; });
    await expect(result).rejects.toEqual(new Error("Unable to load saved monitoring data"));
    await expect(result).rejects.not.toHaveProperty("cause");
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toEqual({
      event: "dashboard_read_error", error: "Error", code: "P1001",
    });
  });
});
