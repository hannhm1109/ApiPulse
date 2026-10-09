import { expect, test } from "@playwright/test";

test("browser security headers cover pages and unauthorized cron requests", async ({ request }) => {
  for (const path of ["/", "/dashboard", "/endpoints/new", "/api/cron/checks"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    expect(headers["x-powered-by"]).toBeUndefined();
    if (path === "/api/cron/checks") {
      expect(response.status()).toBe(401);
      expect(headers["cache-control"]).toContain("no-store");
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } else expect(response.status()).toBe(200);
  }
});

for (const [path, heading] of [
  ["/", "Could not load endpoints"],
  ["/dashboard", "Could not load dashboard"],
  ["/endpoints/fault-endpoint", "Could not load endpoint"],
  ["/endpoints/fault-endpoint/edit", "Could not load endpoint"],
] as const) {
  test(`database outage on ${path} shows a generic, retryable error`, async ({ page }, info) => {
    await page.goto(`http://127.0.0.1:3101${path}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/fault-password|fault-user|postgresql:|Prisma|ECONNREFUSED/);
    const retryRequest = page.waitForRequest(request => request.headers()["rsc"] === "1");
    await page.getByRole("button", { name: "Try again" }).click();
    await retryRequest;
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("database-outage.png"), fullPage: true });
  });
}
