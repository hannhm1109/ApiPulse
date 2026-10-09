import "server-only";

export function isReadOnlyDeployment(): boolean {
  if (process.env.VERCEL === "1") return true;
  const mode = process.env.APIPULSE_MODE;
  if (mode === "local") return false;
  if (mode) return true;
  return process.env.NODE_ENV === "production";
}

export const READ_ONLY_MESSAGE = "Endpoint management is disabled in the public demo.";
