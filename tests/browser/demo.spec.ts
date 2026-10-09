import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

test.use({ baseURL: "http://127.0.0.1:3102" });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL!, max: 3, connectionTimeoutMillis: 5000 }) });
const demoIds = ["demo-healthy", "demo-slow", "demo-recovery"];
const privateId = `browser-demo-private-${randomUUID()}`;
const ownRows = { id: { in: [...demoIds, privateId] } };
let ownsFixtures = false;
test.beforeAll(async () => {
  if (await db.endpoint.count()) throw new Error("Demo browser tests require an empty dedicated database; do not seed it.");
  ownsFixtures = true;
});
test.beforeEach(async () => {
  for (const kind of ["healthy", "slow", "recovery"]) {
    await db.endpoint.create({ data: {
      id: `demo-${kind}`, name: `Demo ${kind[0].toUpperCase() + kind.slice(1)} API`,
      url: `https://demo.example.com/api/demo/${kind}`, enabled: true,
    } });
  }
  await db.endpoint.create({ data: { id: privateId, name: "Hidden private API", url: "https://private.example.com", enabled: true } });
});
test.afterEach(async () => { if (ownsFixtures) await db.endpoint.deleteMany({ where: ownRows }); });
test.afterAll(async () => {
  try { if (ownsFixtures) await db.endpoint.deleteMany({ where: ownRows }); }
  finally { await db.$disconnect(); }
});

test("public list and dashboard hide writes and unrelated records without fabricating observations", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const path of ["/", "/dashboard"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Demo Healthy API", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Add endpoint|^Edit / })).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Hidden private API");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(path === "/" ? "public-endpoints.png" : "public-dashboard.png"), fullPage: true });
  }
  await expect(page.locator(".health-badge").filter({ hasText: "Pending" })).toHaveCount(3);
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(page.getByRole("link", { name: "Demo Healthy API", exact: true })).toBeVisible();
  expect(await db.checkResult.count()).toBe(0);
  expect(await db.incident.count()).toBe(0);
  expect(errors).toEqual([]);
});

test("public endpoint detail has honest empty history and no settings", async ({ page }, info) => {
  await page.goto("/endpoints/demo-healthy");
  await expect(page.getByRole("heading", { name: "Demo Healthy API", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Settings|Edit/ })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  expect(await db.checkResult.count()).toBe(0);
  await page.screenshot({ path: info.outputPath("public-detail.png"), fullPage: true });
  await page.goto(`/endpoints/${privateId}`);
  await expect(page.locator("body")).not.toContainText("Hidden private API");
  await expect(page.getByRole("heading", { name: "Endpoint not found", exact: true })).toBeVisible();
});

test("management routes return 404 and forged writes return 403 with unchanged database rows", async ({ request }) => {
  const before = await db.endpoint.findMany({ orderBy: { id: "asc" } });
  for (const path of ["/endpoints/new", "/endpoints/demo-healthy/edit"]) expect((await request.get(path)).status()).toBe(404);
  for (const path of ["/", "/dashboard", "/endpoints/demo-healthy", "/endpoints/new"]) {
    expect((await request.post(path, { headers: { "Next-Action": "forged-action" }, data: { enabled: false } })).status()).toBe(403);
  }
  expect(await db.endpoint.findMany({ orderBy: { id: "asc" } })).toEqual(before);
});

test("readiness, protected cron and controlled demo responses have safe statuses and no cache", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", mode: "demo" });
  const cron = await request.get("/api/cron/checks");
  expect(cron.status()).toBe(401);
  expect(cron.headers()["cache-control"]).toContain("no-store");
  for (const kind of ["healthy", "slow", "recovery"]) {
    const start = performance.now();
    const response = await request.get(`/api/demo/${kind}?status=418&delay=0`);
    expect(response.status()).toBe(kind === "recovery" && (await response.json()).status === "unhealthy" ? 503 : 200);
    expect(await response.json()).toMatchObject({ demo: true, service: kind });
    expect(response.headers()["cache-control"]).toBe("no-store");
    if (kind === "slow") expect(performance.now() - start).toBeGreaterThanOrEqual(700);
  }
  expect((await request.get("/api/demo/unknown")).status()).toBe(404);
});

test("read-only layouts fit narrow and intermediate widths", async ({ page }) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/dashboard", "/endpoints/demo-slow"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
