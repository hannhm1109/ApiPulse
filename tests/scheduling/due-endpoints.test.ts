import { describe, expect, it } from "vitest";
import { isEndpointDue } from "../../server/monitoring/due-endpoints";

describe("due endpoint policy", () => {
  const now = new Date("2026-10-08T14:00:00Z");
  const endpoint = { enabled: true, lastCheckedAt: null, checkIntervalMinutes: 5 };

  it("checks never-checked endpoints immediately", () => {
    expect(isEndpointDue(endpoint, now)).toBe(true);
  });
  it("excludes disabled endpoints even when never checked", () => {
    expect(isEndpointDue({ ...endpoint, enabled: false }, now)).toBe(false);
  });
  it.each([1, 5, 10])("honors a %i minute interval, including the exact boundary", minutes => {
    const lastCheckedAt = new Date(now.getTime() - minutes * 60_000);
    expect(isEndpointDue({ ...endpoint, lastCheckedAt, checkIntervalMinutes: minutes }, now)).toBe(true);
    expect(isEndpointDue({ ...endpoint, lastCheckedAt: new Date(lastCheckedAt.getTime() + 1), checkIntervalMinutes: minutes }, now)).toBe(false);
  });
  it("does not schedule a future observation", () => {
    expect(isEndpointDue({ ...endpoint, lastCheckedAt: new Date(now.getTime() + 60_000) }, now)).toBe(false);
  });
  it("rejects invalid interval configuration", () => {
    expect(() => isEndpointDue({ ...endpoint, checkIntervalMinutes: 0 }, now)).toThrow(RangeError);
  });
});
