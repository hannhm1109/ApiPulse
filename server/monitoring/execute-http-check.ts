import "server-only";
import { evaluateResponse } from "./evaluate-response";
import { TargetUrlError, validateTargetUrl } from "./ssrf";
import type { CheckConfiguration, CheckOutcome } from "./types";
import { createTargetDispatcher } from "./pinned-dispatcher";
import { MAX_SCHEDULED_TIMEOUT_MS } from "./scheduler-settings";

class CheckTimeoutError extends Error {}
class NetworkRequestError extends Error {}

function isDnsFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN" || error.code === "ENODATA")
  );
}

export async function executeHttpCheck(endpoint: CheckConfiguration): Promise<CheckOutcome> {
  if (
    !Number.isInteger(endpoint.timeoutMs) ||
    endpoint.timeoutMs < 1 ||
    endpoint.timeoutMs > MAX_SCHEDULED_TIMEOUT_MS
  ) {
    throw new RangeError(`timeoutMs must be an integer between 1 and ${MAX_SCHEDULED_TIMEOUT_MS}`);
  }
  if (
    !Number.isInteger(endpoint.expectedStatusCode) ||
    endpoint.expectedStatusCode < 100 ||
    endpoint.expectedStatusCode > 599
  ) {
    throw new RangeError("expectedStatusCode must be an integer between 100 and 599");
  }

  const checkedAt = new Date();
  const startedAt = performance.now();
  const controller = new AbortController();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dispatcher: ReturnType<typeof createTargetDispatcher> | undefined;

  // The deadline covers DNS validation as well as the request, even though DNS cannot be cancelled.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeoutError());
    }, endpoint.timeoutMs);
  });

  const request = async (): Promise<CheckOutcome> => {
    const target = await validateTargetUrl(endpoint.url);
    controller.signal.throwIfAborted();
    dispatcher = createTargetDispatcher(target, endpoint.timeoutMs);
    let response: Response;
    try {
      const options: RequestInit & { dispatcher: typeof dispatcher } = {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
        headers: { "User-Agent": "API-Pulse/0.1" },
        dispatcher,
      };
      response = await fetch(target.url, options);
    } catch (error) {
      if (error instanceof TypeError && error.cause instanceof Error && "code" in error.cause &&
        ["UND_ERR_INVALID_ARG", "UND_ERR_INVALID_RETURN_VALUE", "UND_ERR_DESTROYED", "UND_ERR_CLOSED"]
          .includes(String(error.cause.code))) {
        throw error;
      }
      if (error instanceof TypeError) throw new NetworkRequestError("Network request failed");
      throw error;
    }

    return {
      checkedAt,
      responseTimeMs: elapsed(),
      statusCode: response.status,
      ...evaluateResponse(response.status, endpoint.expectedStatusCode),
    };
  };

  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (controller.signal.aborted || error instanceof CheckTimeoutError) {
      return {
        checkedAt,
        responseTimeMs: elapsed(),
        statusCode: null,
        status: "TIMEOUT",
        failureReason: `Request timed out after ${endpoint.timeoutMs} ms`,
      };
    }

    let failureReason: string;
    if (error instanceof TargetUrlError) {
      failureReason = error.message;
    } else if (isDnsFailure(error)) {
      failureReason = "DNS lookup failed";
    } else if (error instanceof NetworkRequestError) {
      failureReason = error.message;
    } else {
      throw error;
    }

    return {
      checkedAt,
      responseTimeMs: elapsed(),
      statusCode: null,
      status: "FAILURE",
      failureReason,
    };
  } finally {
    clearTimeout(timer);
    // Checks finish at response headers; abort releases the unread response body.
    controller.abort();
    await dispatcher?.destroy();
  }
}
