import "server-only";
import { logServerError } from "./logging";

export async function loadPageData<T>(event: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    logServerError(event, error);
    // Next.js logs uncaught render errors; do not forward database messages or causes.
    throw new Error("Unable to load saved monitoring data");
  }
}
