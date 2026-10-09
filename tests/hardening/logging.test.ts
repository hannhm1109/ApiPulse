import { beforeEach, describe, expect, it, vi } from "vitest";
import { logServerError } from "../../server/logging";

describe("safe structured errors", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  const logged = () => JSON.parse(vi.mocked(console.error).mock.calls.at(-1)![0]);
  it("retains useful category/code/correlation without messages, stack, cause, URL, or credentials", () => {
    const error = Object.assign(new Error("postgresql://user:secret@internal/database"), { code: "P1001", cause: new Error("Bearer secret") });
    logServerError("scheduler_endpoint_error", error, { endpointId: "endpoint", runId: "run" });
    expect(logged()).toEqual({ event: "scheduler_endpoint_error", error: "Error", code: "P1001", endpointId: "endpoint", runId: "run" });
    expect(JSON.stringify(logged())).not.toMatch(/secret|postgresql|Bearer|stack|cause/);
  });
  it("does not log arbitrary strings as error names or codes", () => {
    const error = Object.assign(new Error("secret"), { name: "password=secret", code: "SECRET" });
    logServerError("endpoint_save_error", error);
    expect(logged()).toEqual({ event: "endpoint_save_error", error: "UnknownError" });
  });
  it.each([null, undefined, "secret", { password: "secret" }])("handles unknown errors without serializing their payload %s", error => {
    logServerError("internal_error", error);
    expect(logged()).toEqual({ event: "internal_error", error: "UnknownError" });
  });
  it("retains a known PostgreSQL lock-timeout code", () => {
    logServerError("scheduler_endpoint_error", Object.assign(new Error("lock on secret row"), { code: "55P03" }));
    expect(logged().code).toBe("55P03");
  });
});
