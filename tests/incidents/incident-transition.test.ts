import { describe, expect, it } from "vitest";
import { getIncidentTransition } from "../../server/incidents/incident-transition";

describe("one-failed-check incident policy", () => {
  it("leaves a healthy endpoint without an incident", () => {
    expect(getIncidentTransition("SUCCESS", false)).toBe("NONE");
  });

  it.each(["FAILURE", "TIMEOUT"] as const)("opens an incident on the first %s", status => {
    expect(getIncidentTransition(status, false)).toBe("OPEN");
  });

  it.each(["FAILURE", "TIMEOUT"] as const)("keeps an existing incident open on %s", status => {
    expect(getIncidentTransition(status, true)).toBe("NONE");
  });

  it("resolves an open incident on success", () => {
    expect(getIncidentTransition("SUCCESS", true)).toBe("RESOLVE");
  });
});
