import "server-only";
import { z } from "zod";
import { parseTargetUrl, TargetUrlError } from "../monitoring/target-url";
import { MAX_SCHEDULED_TIMEOUT_MS } from "../monitoring/scheduler-settings";

const integer = (min: number, max: number, message: string) => z.preprocess(
  value => typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value,
  z.number({ error: message }).int(message).min(min, message).max(max, message),
);

export const endpointSchema = z.object({
  name: z.string({ error: "Enter a name." }).trim().min(1, "Enter a name.").max(80, "Use at most 80 characters."),
  url: z.string({ error: "Enter an HTTP or HTTPS URL." }).trim().min(1, "Enter a URL.")
    .max(2048, "Use a URL of at most 2048 characters.").transform((raw, ctx) => {
      try {
        const url = parseTargetUrl(raw);
        if (url.hash) throw new TargetUrlError("Remove the URL fragment; it is not sent to the server.");
        return url.href;
      } catch (error) {
        if (!(error instanceof TargetUrlError)) throw error;
        ctx.addIssue({ code: "custom", message: error.message });
        return z.NEVER;
      }
    }),
  expectedStatusCode: integer(100, 599, "Enter a whole status code from 100 to 599."),
  timeoutMs: integer(1, MAX_SCHEDULED_TIMEOUT_MS, "Enter a whole timeout from 1 to 30000 ms."),
  checkIntervalMinutes: integer(1, 1440, "Enter a whole interval from 1 to 1440 minutes."),
  enabled: z.boolean({ error: "Choose whether monitoring is enabled." }),
});

export const endpointIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

export function endpointFormInput(form: FormData): unknown {
  const enabled = form.get("enabled");
  return {
    name: form.get("name"), url: form.get("url"),
    expectedStatusCode: form.get("expectedStatusCode"), timeoutMs: form.get("timeoutMs"),
    checkIntervalMinutes: form.get("checkIntervalMinutes"),
    enabled: enabled === null ? false : enabled === "on" ? true : enabled,
  };
}
