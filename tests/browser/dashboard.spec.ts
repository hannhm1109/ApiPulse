import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL!, max: 3, connectionTimeoutMillis: 5000 }) });
const prefix = `browser-dashboard-${randomUUID().slice(0, 8)}-`;
const ownRows = { id: { startsWith: prefix } };

test.beforeAll(async () => {
  if (await db.endpoint.count()) throw new Error("Browser tests require an empty dedicated database; do not seed it.");
});
test.afterEach(async () => { await db.endpoint.deleteMany({ where: ownRows }); });
test.afterAll(async () => { try { await db.endpoint.deleteMany({ where: ownRows }); } finally { await db.$disconnect(); } });

function metric(page: Page, label: string) {
  return page.locator(".dashboard-metrics > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
}
function healthRow(page: Page, name: string) {
  return page.locator(".dashboard-table tbody tr").filter({ has: page.getByRole("link", { name, exact: true }) });
}
async function fixture(suffix: string, name: string, status: "SUCCESS" | "FAILURE" | "TIMEOUT" | null, age = 30_000, enabled = true) {
  const checkedAt = new Date(Date.now() - age);
  const endpoint = await db.endpoint.create({ data: { id: `${prefix}${suffix}`, name, enabled, url: `https://${suffix}.example.com/health`,
    checkIntervalMinutes: 5, lastCheckedAt: status ? checkedAt : null } });
  if (status) {
    const reason = status === "TIMEOUT" ? "Request timed out after 5000 ms" : status === "FAILURE" ? "Unexpected HTTP status: 503 (expected 200)" : null;
    const check = await db.checkResult.create({ data: { endpointId: endpoint.id, checkedAt, status,
      responseTimeMs: status === "TIMEOUT" ? 5000 : 142, statusCode: status === "TIMEOUT" ? null : status === "FAILURE" ? 503 : 200, failureReason: reason } });
    if (status !== "SUCCESS") await db.incident.create({ data: { endpointId: endpoint.id, startedAt: checkedAt, cause: reason!, firstFailedCheckId: check.id } });
  }
  return endpoint;
}
async function mixedFixtures() {
  await fixture("payments", "Payments API", "SUCCESS");
  await fixture("orders", "Orders API", "FAILURE");
  await fixture("warehouse", "Warehouse API", "TIMEOUT", 60_000);
  await fixture("notifications", "Notifications API", null);
  await fixture("reports", "Reports API", "SUCCESS", 60_000, false);
  await fixture("legacy", "Legacy API", "FAILURE", 120_000, false);
  await fixture("invoices", "Invoices API", "SUCCESS", 1_800_000);
  await fixture("clock", "Clock API", "SUCCESS", -300_000);
}

test("empty dashboard shows zero observations and working navigation", async ({ page }, info) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  for (const label of ["Total endpoints", "Healthy", "Down", "Active incidents"]) await expect(metric(page, label)).toHaveText("0");
  await expect(page.getByText("No active incidents", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No endpoints yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: info.outputPath("empty-dashboard.png"), fullPage: true });
  await page.getByRole("link", { name: "Endpoints", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Endpoints", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Endpoints", exact: true })).toHaveAttribute("aria-current", "page");
});

test("real observations, response timings, stale states, and disabled incidents render correctly", async ({ page }, info) => {
  await mixedFixtures();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(metric(page, "Total endpoints")).toHaveText("8");
  await expect(metric(page, "Healthy")).toHaveText("1");
  await expect(metric(page, "Down")).toHaveText("2");
  await expect(metric(page, "Active incidents")).toHaveText("3");
  await expect(healthRow(page, "Payments API").locator(".health-badge")).toHaveText("Up");
  await expect(healthRow(page, "Payments API").locator("td").nth(1)).toContainText("142 ms");
  await expect(healthRow(page, "Warehouse API").locator("td").nth(1)).toContainText("--");
  await expect(healthRow(page, "Invoices API").locator(".health-badge")).toHaveText("Stale");
  await expect(healthRow(page, "Notifications API").locator(".health-badge")).toHaveText("Pending");
  await expect(healthRow(page, "Clock API").locator(".health-badge")).toHaveText("Unknown");
  await expect(healthRow(page, "Legacy API").locator(".health-badge")).toHaveText("Disabled");
  await expect(page.locator(".active-incident-list li").filter({ hasText: "Legacy API" })).toContainText("Monitoring disabled");
  await expect(page.locator(".active-incident-list li")).toHaveCount(3);
  await expect(healthRow(page, "Payments API").getByRole("img")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("dashboard.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("search and status filters narrow rows without changing workspace counts", async ({ page }) => {
  await mixedFixtures();
  await page.goto("/dashboard");
  await page.getByLabel("Filter endpoint health").selectOption("DOWN");
  await expect(page.locator(".dashboard-table tbody tr")).toHaveCount(2);
  await expect(metric(page, "Total endpoints")).toHaveText("8");
  await expect(page.locator(".active-incident-list li")).toHaveCount(3);
  await page.getByLabel("Search dashboard endpoints").fill("warehouse.example.com");
  await expect(page.locator(".dashboard-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear dashboard search" }).click();
  await page.getByLabel("Filter endpoint health").selectOption("UP");
  await expect(page.locator(".dashboard-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Search dashboard endpoints").fill("does-not-exist");
  await expect(page.getByRole("heading", { name: "No matching endpoints" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".dashboard-table tbody tr")).toHaveCount(8);
});

test("refresh shows recovery from new persisted data without executing checks", async ({ page }) => {
  const endpoint = await fixture("recover", "Recovering API", "FAILURE");
  await page.goto("/dashboard");
  await expect(metric(page, "Down")).toHaveText("1");
  await db.$transaction(async tx => {
    const recovery = await tx.checkResult.create({ data: { endpointId: endpoint.id, status: "SUCCESS", checkedAt: new Date(), statusCode: 200, responseTimeMs: 0 } });
    await tx.endpoint.update({ where: { id: endpoint.id }, data: { lastCheckedAt: recovery.checkedAt } });
    await tx.incident.updateMany({ where: { endpointId: endpoint.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: recovery.checkedAt, recoveryCheckId: recovery.id } });
  });
  await expect(metric(page, "Down")).toHaveText("1");
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(metric(page, "Healthy")).toHaveText("1");
  await expect(metric(page, "Down")).toHaveText("0");
  await expect(metric(page, "Active incidents")).toHaveText("0");
  await expect(healthRow(page, "Recovering API").locator("td").nth(1)).toContainText("0 ms");
  expect(await db.checkResult.count({ where: { endpointId: endpoint.id } })).toBe(2);
});

test("settings edits invalidate a previously visited dashboard", async ({ page }) => {
  await fixture("edit", "Editable API", "SUCCESS");
  await page.goto("/dashboard");
  await expect(metric(page, "Healthy")).toHaveText("1");
  await page.getByRole("link", { name: "Edit Editable API", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit endpoint" })).toBeVisible();
  await page.getByRole("switch").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Endpoints", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(metric(page, "Healthy")).toHaveText("0");
  await expect(healthRow(page, "Editable API").locator(".health-badge")).toHaveText("Disabled");
});

test("recent status marks show only recorded results in chronological order", async ({ page }) => {
  const endpoint = await fixture("timeline", "Timeline API", "SUCCESS", 1000);
  const latest = await db.checkResult.findFirstOrThrow({ where: { endpointId: endpoint.id } });
  await db.checkResult.createMany({ data: [
    { endpointId: endpoint.id, status: "TIMEOUT", checkedAt: new Date(latest.checkedAt.getTime() - 2000), statusCode: null, responseTimeMs: 5000 },
    { endpointId: endpoint.id, status: "FAILURE", checkedAt: new Date(latest.checkedAt.getTime() - 1000), statusCode: 503, responseTimeMs: 120 },
  ] });
  await page.goto("/dashboard");
  const marks = healthRow(page, "Timeline API").getByRole("img");
  await expect(marks).toHaveCount(3);
  await expect(marks.nth(0)).toHaveAttribute("aria-label", /^TIMEOUT/);
  await expect(marks.nth(1)).toHaveAttribute("aria-label", /^FAILURE/);
  await expect(marks.nth(2)).toHaveAttribute("aria-label", /^SUCCESS/);
  const colors = await marks.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
  expect(new Set(colors).size).toBe(3);
  expect(colors).not.toContain("rgba(0, 0, 0, 0)");
});

test("long incident causes and endpoint URLs fit across narrow and intermediate viewports", async ({ page }) => {
  const endpoint = await fixture("long", "A".repeat(80), "FAILURE");
  await db.endpoint.update({ where: { id: endpoint.id }, data: { url: "https://example.com/" + "x".repeat(1800) } });
  await db.incident.updateMany({ where: { endpointId: endpoint.id }, data: { cause: "Long failure reason ".repeat(60) } });
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(metric(page, "Down")).toHaveText("1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
