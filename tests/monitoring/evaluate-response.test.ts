import { describe, expect, it } from "vitest";
import { evaluateResponse } from "../../server/monitoring/evaluate-response";

describe("evaluateResponse", () => {
  it.each([200, 204, 302, 404])("accepts the configured status %i", (status) => {
    expect(evaluateResponse(status, status)).toEqual({ status: "SUCCESS", failureReason: null });
  });

  it("records an unexpected HTTP status as a failure", () => {
    expect(evaluateResponse(500, 200)).toEqual({
      status: "FAILURE",
      failureReason: "Unexpected HTTP status: 500 (expected 200)",
    });
  });
});
