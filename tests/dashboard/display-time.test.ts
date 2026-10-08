import { describe, expect, it } from "vitest";
import { formatDuration, relativeTime, utcTime } from "../../lib/display-time";

describe("snapshot time display", () => {
  it.each([[0, "<1s"], [59000, "59s"], [60000, "1m"], [3660000, "1h 1m"], [90000000, "1d 1h"], [-1, "--"], [NaN, "--"]])(
    "formats duration %s as %s", (duration, expected) => { expect(formatDuration(Number(duration))).toBe(expected); },
  );
  it.each([[0, "Just now"], [59, "59 sec ago"], [60, "1 min ago"], [3600, "1 hr ago"], [86400, "1 day ago"], [-1, "Future timestamp"]])(
    "formats relative age %s as %s", (seconds, expected) => {
      const now = new Date("2026-10-08T16:00:00Z");
      expect(relativeTime(new Date(now.getTime() - Number(seconds) * 1000).toISOString(), now.toISOString())).toBe(expected);
    },
  );
  it("handles invalid relative timestamps", () => {
    expect(relativeTime("invalid", "2026-10-08T16:00:00Z")).toBe("Unknown");
  });
  it("uses a fixed UTC clock regardless of the server's local timezone", () => {
    expect(utcTime("2026-10-08T17:03:04+01:00")).toBe("16:03:04");
  });
});
