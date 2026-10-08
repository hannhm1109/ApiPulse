import type { CheckStatus } from "../../generated/prisma/enums";

export type IncidentTransition = "OPEN" | "RESOLVE" | "NONE";

export function getIncidentTransition(
  status: CheckStatus,
  hasOpenIncident: boolean,
): IncidentTransition {
  if (status === "SUCCESS") return hasOpenIncident ? "RESOLVE" : "NONE";
  return hasOpenIncident ? "NONE" : "OPEN";
}
