import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL!, max: 3, connectionTimeoutMillis: 5000 }) });
const prefix = `browser-${randomUUID().slice(0, 8)}-`;
const ownRows = { OR: [{ name: { startsWith: prefix } }, { id: { startsWith: prefix } }] };
const config = { url: "https://api.example.com/health", enabled: false, expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5 };

test.beforeAll(async () => {
  if (await db.endpoint.count()) throw new Error("Browser tests require an empty dedicated test database; do not seed it.");
});
test.afterEach(async () => { await db.endpoint.deleteMany({ where: ownRows }); });
test.afterAll(async () => { try { await db.endpoint.deleteMany({ where: ownRows }); } finally { await db.$disconnect(); } });

test("empty state and cancel leave the database untouched", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No endpoints yet" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("empty.png"), fullPage: true });
  await page.getByRole("link", { name: "Add endpoint", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add endpoint" })).toBeVisible();
  await expect(page.getByLabel("Timeout", { exact: false })).toHaveValue("5000");
  await expect(page.getByRole("switch")).toBeChecked();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  expect(await db.endpoint.count()).toBe(0);
});

test("server validation retains entered values, focuses the first error, and rejects unsafe URLs", async ({ page }, info) => {
  await page.goto("/endpoints/new");
  await page.getByLabel("URL", { exact: false }).fill("http://127.0.0.1/health");
  await page.getByLabel("Expected status").fill("99");
  await page.getByLabel("Timeout", { exact: false }).fill("30001");
  await page.getByLabel("Check interval", { exact: false }).fill("0");
  await page.getByRole("button", { name: "Create endpoint", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check the highlighted fields." })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(page.getByLabel("URL", { exact: false })).toHaveValue("http://127.0.0.1/health");
  await expect(page.getByLabel("Timeout", { exact: false })).toHaveValue("30001");
  await expect(page.getByRole("switch")).toBeChecked();
  await expect(page.locator("#url-error")).toContainText("public IP addresses");
  await page.screenshot({ path: info.outputPath("validation.png"), fullPage: true });
  expect(await db.endpoint.count()).toBe(0);
});

test("create, persist, disable, enable, filter, and edit an endpoint", async ({ page }) => {
  const name = `${prefix}Payments API`;
  await page.goto("/endpoints/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("URL", { exact: false }).fill(config.url);
  await page.getByRole("button", { name: "Create endpoint", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  const saved = await db.endpoint.findFirstOrThrow({ where: { name } });
  expect(saved).toMatchObject({ ...config, enabled: true, lastCheckedAt: null });

  const toggle = page.getByRole("switch", { name: `Monitoring for ${name}` });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  expect((await db.endpoint.findUniqueOrThrow({ where: { id: saved.id } })).enabled).toBe(false);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByLabel("Filter monitoring").selectOption("disabled");
  await expect(page.getByRole("heading", { name: "No matching endpoints" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search endpoints").fill("no-such-service");
  await expect(page.getByRole("heading", { name: "No matching endpoints" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("link", { name: `Edit ${name}`, exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
  await page.getByLabel("Name", { exact: true }).fill(`${prefix}Updated Payments API`);
  await page.getByLabel("URL", { exact: false }).fill("https://api.example.com/v2/health");
  await page.getByLabel("Expected status").fill("204");
  await page.getByLabel("Timeout", { exact: false }).fill("8000");
  await page.getByLabel("Check interval", { exact: false }).fill("10");
  await page.getByRole("switch").uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  await page.reload();
  expect(await db.endpoint.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
    name: `${prefix}Updated Payments API`, url: "https://api.example.com/v2/health", expectedStatusCode: 204,
    timeoutMs: 8000, checkIntervalMinutes: 10, enabled: false,
  });
  await expect(page.getByRole("switch")).not.toBeChecked();
  await expect(page.locator(".status-code")).toHaveText("204");
});

test("responsive list and form render without overflow or browser errors", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [index, name] of ["Payments API", "Orders API", "Notifications API"].entries()) {
    await db.endpoint.create({ data: { id: `${prefix}${index}`, name: `${prefix}${name}`, ...config, enabled: index !== 1, checkIntervalMinutes: index === 1 ? 10 : 5 } });
  }
  await page.goto("/");
  await expect(page.getByRole("switch")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("list.png"), fullPage: true });
  await page.getByRole("link", { name: "Add endpoint", exact: true }).click();
  await expect(page.getByRole("link", { name: "API Pulse home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add endpoint" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create endpoint", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("form.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("long names and URLs fit on narrow and intermediate widths", async ({ page }) => {
  await db.endpoint.create({ data: { id: `${prefix}long`, ...config, name: prefix + "x".repeat(80 - prefix.length),
    url: "https://api.example.com/" + "x".repeat(1800), timeoutMs: 30000, checkIntervalMinutes: 1440 } });
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("switch")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".endpoint-url").evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(40);
    await expect(page.locator(".endpoint-url")).toHaveAttribute("title", "https://api.example.com/" + "x".repeat(1800));
    const identity = await page.locator(".endpoint-identity").boundingBox();
    const monitoring = await page.locator(".monitoring-toggle").boundingBox();
    expect(identity).not.toBeNull();
    expect(monitoring).not.toBeNull();
    if (monitoring!.y < identity!.y + identity!.height) {
      expect(identity!.x + identity!.width).toBeLessThanOrEqual(monitoring!.x);
    } else {
      expect(monitoring!.y).toBeGreaterThanOrEqual(identity!.y + identity!.height);
    }
  }
});

test("a missing edit URL renders a useful not-found page", async ({ page }) => {
  await page.goto("/endpoints/no-such-endpoint/edit");
  await expect(page.getByRole("heading", { name: "Endpoint not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to endpoints" }).click();
  await expect(page.getByRole("heading", { name: "Endpoints", exact: true })).toBeVisible();
});
