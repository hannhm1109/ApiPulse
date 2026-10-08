import { describe, expect, it } from "vitest";
import { endpointFormInput, endpointSchema } from "../../server/endpoints/validation";

const valid = { name: "Payments API", url: "https://api.example.com/health", expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5, enabled: true };

describe("endpoint configuration validation", () => {
  it("trims text, normalizes URLs, and converts integer form fields", () => {
    expect(endpointSchema.parse({ ...valid, name: "  Payments API  ", url: " HTTPS://API.EXAMPLE.COM:443/health ",
      expectedStatusCode: "200", timeoutMs: " 5000 ", checkIntervalMinutes: "5" })).toEqual(valid);
  });
  it.each([
    ["name", ""], ["name", "   "], ["name", "x".repeat(81)], ["url", ""], ["url", "invalid"],
    ["url", "https://example.com/" + "x".repeat(2048)],
    ["url", "ftp://example.com/health"], ["url", "https://user:secret@example.com/"],
    ["url", "http://localhost/health"], ["url", "http://127.0.0.1"], ["url", "http://2130706433"],
    ["url", "http://[::ffff:127.0.0.1]"], ["url", "http://169.254.169.254"], ["url", "http://10.1.1.1"],
    ["url", "https://api.internal"], ["url", "https://example.com/health#fragment"],
    ["expectedStatusCode", 99], ["expectedStatusCode", 600], ["expectedStatusCode", "200.5"],
    ["expectedStatusCode", "2e2"], ["expectedStatusCode", true], ["timeoutMs", ""], ["timeoutMs", null],
    ["timeoutMs", 0], ["timeoutMs", 30001], ["timeoutMs", NaN], ["timeoutMs", Infinity],
    ["checkIntervalMinutes", 0], ["checkIntervalMinutes", 1441], ["checkIntervalMinutes", 1.5], ["enabled", "false"],
  ])("rejects invalid %s value %s", (field, value) => {
    const result = endpointSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === field)).toBe(true);
  });
  it.each([100, 599])("accepts status boundary %s", expectedStatusCode => {
    expect(endpointSchema.safeParse({ ...valid, expectedStatusCode }).success).toBe(true);
  });
  it.each([1, 30000])("accepts timeout boundary %s", timeoutMs => {
    expect(endpointSchema.safeParse({ ...valid, timeoutMs }).success).toBe(true);
  });
  it.each([1, 1440])("accepts interval boundary %s", checkIntervalMinutes => {
    expect(endpointSchema.safeParse({ ...valid, checkIntervalMinutes }).success).toBe(true);
  });
  it("accepts public IPs without a DNS or HTTP request", () => {
    expect(endpointSchema.parse({ ...valid, url: "https://[2606:4700:4700::1111]/health" }).url).toContain("2606:4700");
  });
  it("strips unexpected fields rather than exposing writable monitoring state", () => {
    expect(endpointSchema.parse({ ...valid, id: "injected", lastCheckedAt: new Date(), checkClaimToken: "injected" })).toEqual(valid);
  });
  it("extracts checkbox values explicitly instead of coercing strings to booleans", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(valid)) if (key !== "enabled") form.set(key, String(value));
    expect(endpointSchema.parse(endpointFormInput(form)).enabled).toBe(false);
    form.set("enabled", "on");
    expect(endpointSchema.parse(endpointFormInput(form)).enabled).toBe(true);
    form.set("enabled", "false");
    expect(endpointSchema.safeParse(endpointFormInput(form)).success).toBe(false);
    form.set("name", new Blob(["Payments"]), "file.txt");
    expect(endpointSchema.safeParse(endpointFormInput(form)).success).toBe(false);
  });
});
