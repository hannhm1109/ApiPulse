import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL!, max: 3, connectionTimeoutMillis: 5000 }) });
const prefix = `browser-detail-${randomUUID().slice(0, 8)}-`;
const ownRows = { id: { startsWith: prefix } };
test.beforeAll(async () => { if (await db.endpoint.count()) throw new Error("Browser tests require an empty dedicated test database; do not seed it."); });
test.afterEach(async () => { await db.endpoint.deleteMany({ where: ownRows }); });
test.afterAll(async () => { try { await db.endpoint.deleteMany({ where: ownRows }); } finally { await db.$disconnect(); } });

const create = (suffix: string, fields = {}) => db.endpoint.create({ data: { id: `${prefix}${suffix}`, name: "Payments API", url: "https://payments.example.com/health", enabled: true, ...fields } });
const metric = (page: Page, label: string) => page.locator(".detail-metrics > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");

async function historyFixture() {
  const endpoint = await create("history");
  const reference = Date.now() - 60_000;
  const checks = await Promise.all(Array.from({ length: 30 }, (_, index) => {
    const status = index === 4 || index === 5 ? "TIMEOUT" : index >= 6 && index <= 8 ? "FAILURE" : "SUCCESS";
    return db.checkResult.create({ data: { endpointId: endpoint.id, checkedAt: new Date(reference - index * 1_800_000), status,
      statusCode: status === "TIMEOUT" ? null : status === "FAILURE" ? 503 : 200,
      responseTimeMs: status === "TIMEOUT" ? 5000 : index === 0 ? 0 : 100 + index * 37 % 240,
      failureReason: status === "SUCCESS" ? null : status === "TIMEOUT" ? "Request timed out after 5000 ms" : "Unexpected HTTP status: 503 (expected 200)" } });
  }));
  await db.incident.create({ data: { endpointId: endpoint.id, status: "RESOLVED", startedAt: checks[8].checkedAt, resolvedAt: checks[3].checkedAt,
    cause: "Unexpected HTTP status: 503 (expected 200)", firstFailedCheckId: checks[8].id, recoveryCheckId: checks[3].id } });
  await db.checkResult.createMany({ data: [2, 8, 31].map(days => ({ endpointId: endpoint.id, checkedAt: new Date(reference - days * 86_400_000), status: "SUCCESS", statusCode: 200, responseTimeMs: 142 })) });
  await db.endpoint.update({ where: { id: endpoint.id }, data: { lastCheckedAt: checks[0].checkedAt } });
  return endpoint;
}

test("an unobserved endpoint has empty metrics and missing endpoints have a useful fallback", async ({ page }, info) => {
  const endpoint = await create("empty");
  await page.goto(`/endpoints/${endpoint.id}`);
  await expect(page.getByRole("heading", { name: "Payments API", exact: true })).toBeVisible();
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Pending");
  await expect(metric(page, "Check-based uptime")).toHaveText("--");
  await expect(metric(page, "Average response")).toHaveText("--");
  await expect(metric(page, "Last checked")).toHaveText("Never");
  await expect(page.getByText("No checks in this period", { exact: true })).toHaveCount(2);
  await expect(page.getByText("No incidents recorded", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("detail-empty.png"), fullPage: true });
  const response = await page.goto("/endpoints/no-such-endpoint");
  // Streaming can send HTTP 200 before notFound is discovered; the rendered fallback is the contract.
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "Endpoint not found" })).toBeVisible();
});

test("full-window metrics, response gaps, and resolved incident durations render with a real chart", async ({ page }, info) => {
  const endpoint = await historyFixture();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/endpoints/${endpoint.id}`);
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Up");
  await expect(metric(page, "Check-based uptime")).toHaveText("83.87%");
  await expect(metric(page, "Latest response")).toHaveText("0 ms");
  await expect(page.locator(".detail-check-counts")).toContainText("31 completed checks");
  await expect(page.locator(".check-table tbody tr")).toHaveCount(25);
  const timeoutRows = page.locator(".check-table tbody tr").filter({ hasText: "Timeout" });
  await expect(timeoutRows).toHaveCount(2);
  await expect(timeoutRows.first().locator(".response-latency")).toHaveText("--");
  await expect(page.locator(".incident-history-table tbody tr")).toContainText("Resolved");
  await expect(page.locator(".incident-history-table tbody tr")).toContainText("2h 30m");
  const canvas = page.locator(".latency-plot canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let bluePixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 100 && data[index + 1] >= 70 && data[index + 1] < 130 && data[index + 2] > 110 && data[index + 3] > 100) bluePixels++;
    }
    return bluePixels;
  })).toBeGreaterThan(50);
  await page.locator(".latency-plot .u-over").hover({ position: { x: 40, y: 50 } });
  await expect(page.locator(".u-legend .u-value").last()).not.toHaveText("--");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("endpoint-detail.png"), fullPage: true });
  await page.locator(".latency-plot").screenshot({ path: info.outputPath("latency-chart.png") });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("detail-overview.png"), fullPage: false });
  if (info.project.name === "mobile") {
    await page.getByRole("navigation", { name: "Endpoint sections" }).getByRole("link", { name: "Latency", exact: true }).click();
    await page.screenshot({ path: info.outputPath("detail-latency.png"), fullPage: false, scale: "css" });
  }
  await page.locator(".chart-data summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".chart-data-table tbody tr")).toHaveCount(31);
  expect(errors).toEqual([]);
});

test("period selection changes full-window metrics and pagination preserves the period", async ({ page }) => {
  const endpoint = await historyFixture();
  await page.goto(`/endpoints/${endpoint.id}`);
  await page.getByRole("link", { name: "24 hours", exact: true }).click();
  await expect(metric(page, "Check-based uptime")).toHaveText("83.33%");
  await expect(page.locator(".detail-check-counts")).toContainText("30 completed checks");
  await page.getByRole("link", { name: "Next checks page" }).click();
  await expect(page).toHaveURL(new RegExp("period=24h&checkPage=2#checks$"));
  await expect(page.locator(".check-table tbody tr")).toHaveCount(5);
  await expect(metric(page, "Check-based uptime")).toHaveText("83.33%");
  await expect(page.getByRole("button", { name: "Next checks page" })).toBeDisabled();
  await page.getByRole("link", { name: "Previous checks page" }).click();
  await expect(page.locator(".check-table tbody tr")).toHaveCount(25);
  await page.getByRole("link", { name: "30 days", exact: true }).click();
  await expect(page.locator(".detail-check-counts")).toContainText("32 completed checks");
  await expect(metric(page, "Check-based uptime")).toHaveText("84.38%");
  await expect(page.getByRole("navigation", { name: "History period" }).getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "true");
  await page.goto(`/endpoints/${endpoint.id}?period=invalid&checkPage=-2`);
  await expect(page.locator(".detail-check-counts")).toContainText("31 completed checks");
});

test("refresh reads a persisted recovery without executing checks and settings revalidate detail", async ({ page }) => {
  const endpoint = await create("refresh");
  const failure = await db.checkResult.create({ data: { endpointId: endpoint.id, checkedAt: new Date(Date.now() - 60_000), status: "TIMEOUT", statusCode: null, responseTimeMs: 5000, failureReason: "Request timed out after 5000 ms" } });
  await db.incident.create({ data: { endpointId: endpoint.id, startedAt: failure.checkedAt, cause: failure.failureReason!, firstFailedCheckId: failure.id } });
  await page.goto(`/endpoints/${endpoint.id}`);
  await expect(page.locator(".detail-active-incident")).toContainText("Incident open");
  await expect(metric(page, "Latest response")).toHaveText("--");
  await expect(page.getByText("No response timings in this period", { exact: true })).toBeVisible();
  await db.$transaction(async tx => {
    const recovery = await tx.checkResult.create({ data: { endpointId: endpoint.id, checkedAt: new Date(), status: "SUCCESS", statusCode: 200, responseTimeMs: 142 } });
    await tx.incident.updateMany({ where: { endpointId: endpoint.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: recovery.checkedAt, recoveryCheckId: recovery.id } });
    await tx.endpoint.update({ where: { id: endpoint.id }, data: { lastCheckedAt: recovery.checkedAt } });
  });
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Down");
  await page.getByRole("button", { name: "Refresh endpoint" }).click();
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Up");
  await expect(metric(page, "Check-based uptime")).toHaveText("50.00%");
  await expect(page.locator(".detail-active-incident")).toHaveCount(0);
  expect(await db.checkResult.count({ where: { endpointId: endpoint.id } })).toBe(2);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("switch").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("link", { name: "Payments API", exact: true }).click();
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Disabled");
  await expect(metric(page, "Check-based uptime")).toHaveText("50.00%");
});

test("dashboard and management names open detail while edit controls stay available", async ({ page }) => {
  const endpoint = await create("navigation");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Payments API", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/endpoints/${endpoint.id}$`));
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Endpoints", exact: true }).click();
  await page.getByRole("link", { name: "Payments API", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Health overview" })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("single and tied observations do not fabricate a continuous chart", async ({ page }) => {
  const endpoint = await create("single");
  const checkedAt = new Date(Date.now() - 60_000);
  await db.checkResult.createMany({ data: [0, 142].map(responseTimeMs => ({ endpointId: endpoint.id, checkedAt, status: "SUCCESS", statusCode: 200, responseTimeMs })) });
  await page.goto(`/endpoints/${endpoint.id}`);
  await expect(page.locator(".chart-empty")).toContainText("One response observation");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".check-table tbody tr")).toHaveCount(2);
  await expect(metric(page, "Check-based uptime")).toHaveText("100.00%");
});

test("copy endpoint URL reports both clipboard success and denial without changing data", async ({ page }) => {
  const endpoint = await create("clipboard");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { document.documentElement.dataset.copiedUrl = value; },
    } });
  });
  await page.goto(`/endpoints/${endpoint.id}`);
  await page.getByRole("button", { name: "Copy endpoint URL" }).click();
  await expect(page.getByRole("status")).toHaveText("URL copied");
  expect(await page.evaluate(() => document.documentElement.dataset.copiedUrl)).toBe(endpoint.url);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("Clipboard denied"); },
    } });
  });
  await page.getByRole("button", { name: "Copy endpoint URL" }).click();
  await expect(page.getByRole("status")).toHaveText("Could not copy URL");
  expect(await db.checkResult.count({ where: { endpointId: endpoint.id } })).toBe(0);
});

test("section shortcuts preserve the selected period and land below sticky navigation", async ({ page }) => {
  const endpoint = await historyFixture();
  await page.goto(`/endpoints/${endpoint.id}?period=24h`);
  const sections = page.getByRole("navigation", { name: "Endpoint sections" });
  for (const [label, hash] of [["Latency", "latency"], ["Checks", "checks"], ["Overview", "overview"]]) {
    await sections.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`period=24h#${hash}$`));
    const target = await page.locator(`#${hash}`).boundingBox();
    const nav = await sections.boundingBox();
    expect(target!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  const bounds = await mainNav.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  expect(bounds!.y).toBeGreaterThan(600);
  await mainNav.getByRole("link", { name: "Endpoints", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Endpoints", exact: true })).toBeVisible();
});

test("incident pages preserve an open incident independently of the page", async ({ page }) => {
  const endpoint = await create("incident-pages", { enabled: false });
  const reference = Date.now() - 60_000;
  for (let index = 26; index >= 0; index--) {
    const failure = await db.checkResult.create({ data: { endpointId: endpoint.id, checkedAt: new Date(reference - index * 120_000), status: "FAILURE", statusCode: 503, responseTimeMs: 142 } });
    const recovery = index > 0 ? await db.checkResult.create({ data: { endpointId: endpoint.id, checkedAt: new Date(failure.checkedAt.getTime() + 60_000), status: "SUCCESS", statusCode: 200, responseTimeMs: 142 } }) : null;
    await db.incident.create({ data: { endpointId: endpoint.id, firstFailedCheckId: failure.id, startedAt: failure.checkedAt, cause: "Unexpected HTTP status: 503", status: recovery ? "RESOLVED" : "OPEN",
      resolvedAt: recovery?.checkedAt, recoveryCheckId: recovery?.id } });
  }
  await page.goto(`/endpoints/${endpoint.id}`);
  await expect(page.locator(".detail-title .health-badge")).toHaveText("Disabled");
  await page.getByRole("link", { name: "Next incidents page" }).click();
  await expect(page.locator(".incident-history-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".detail-active-incident")).toContainText("Incident open");
  await expect(page.locator(".incident-history-table tbody")).not.toContainText("Open");
});

test("long names, URLs, and causes fit and the chart resizes across viewport widths", async ({ page }) => {
  const endpoint = await historyFixture();
  await db.endpoint.update({ where: { id: endpoint.id }, data: { name: "A".repeat(80), url: "https://example.com/" + "x".repeat(1800) } });
  await db.incident.updateMany({ where: { endpointId: endpoint.id }, data: { cause: "LongCause".repeat(100) } });
  await db.checkResult.updateMany({ where: { endpointId: endpoint.id, status: "FAILURE" }, data: { failureReason: "LongFailureReason".repeat(60) } });
  await page.goto(`/endpoints/${endpoint.id}`);
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const chart = await page.locator(".latency-plot .uplot").boundingBox();
      const plot = await page.locator(".latency-plot").boundingBox();
      return chart && plot ? Math.abs(chart.width - plot.width) : 999;
    }).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
