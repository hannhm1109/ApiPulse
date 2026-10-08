import type { CheckStatus } from "../../generated/prisma/enums";
import type { Endpoint } from "../../generated/prisma/client";

export type CheckConfiguration = Pick<
  Endpoint,
  "url" | "expectedStatusCode" | "timeoutMs"
>;

export type CheckOutcome = {
  checkedAt: Date;
  responseTimeMs: number;
  statusCode: number | null;
  status: CheckStatus;
  failureReason: string | null;
};
