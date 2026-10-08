import type { CheckOutcome } from "./types";

export function evaluateResponse(
  statusCode: number,
  expectedStatusCode: number,
): Pick<CheckOutcome, "status" | "failureReason"> {
  if (statusCode === expectedStatusCode) {
    return { status: "SUCCESS", failureReason: null };
  }

  return {
    status: "FAILURE",
    failureReason: `Unexpected HTTP status: ${statusCode} (expected ${expectedStatusCode})`,
  };
}
