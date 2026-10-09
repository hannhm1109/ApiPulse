import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { requireTestDatabaseUrl } from "./scripts/test-database-url.ts";

const connectionString = requireTestDatabaseUrl();

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: [{
    command: "npm run start -- --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: connectionString, CRON_SECRET: "browser-only-cron-secret-not-for-deployment", APIPULSE_MODE: "local", VERCEL: "0" },
  }, {
    command: "npm run start -- --port 3101 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3101/endpoints/new",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: "postgresql://fault-user:fault-password@127.0.0.1:1/fault-database",
      CRON_SECRET: "browser-only-cron-secret-not-for-deployment",
      APIPULSE_MODE: "local", VERCEL: "0",
    },
  }, {
    command: "npm run start -- --port 3102 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3102/api/demo/healthy",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: connectionString, DATABASE_CONNECTION_MODE: "direct",
      CRON_SECRET: "browser-only-cron-secret-not-for-deployment",
      APIPULSE_MODE: "demo", VERCEL: "1", DEMO_BASE_URL: "https://demo.example.com",
    },
  }],
});
