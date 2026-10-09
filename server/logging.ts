import "server-only";

const safeErrorNames = new Set([
  "Error", "TypeError", "RangeError", "AbortError", "CheckClaimLostError",
  "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError",
  "PrismaClientValidationError", "PrismaClientRustPanicError",
]);
const safeSystemCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57014", "55P03", "23505"]);

export function logServerError(event: string, error: unknown, context: { endpointId?: string; runId?: string } = {}) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  console.error(JSON.stringify({
    event, ...context, error: safeErrorNames.has(name) ? name : "UnknownError",
    code: code && (safeSystemCodes.has(code) || /^P\d{4}$/.test(code)) ? code : undefined,
  }));
}
