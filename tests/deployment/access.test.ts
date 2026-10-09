import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isReadOnlyDeployment } from "../../server/deployment";
import { proxy } from "../../proxy";
import { saveEndpoint, setEndpointEnabled, getEndpoint } from "../../server/endpoints/endpoint-service";
import { getEndpointDetail } from "../../server/endpoint-detail/detail-service";
import { prisma } from "../../server/db/prisma";

vi.mock("../../server/db/prisma", () => ({ prisma: {} }));

describe("deployment access", () => {
  beforeEach(() => { vi.stubEnv("VERCEL", "0"); vi.stubEnv("APIPULSE_MODE", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["development", "", "0", false], ["test", "", "0", false],
    ["production", "", "0", true], ["production", "local", "0", false],
    ["development", "demo", "0", true], ["production", "typo", "0", true],
    ["production", "local", "1", true], ["development", "local", "1", true],
  ])("fails closed for hosted/default-production mode: %s %s %s", (nodeEnv, mode, vercel, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv); vi.stubEnv("APIPULSE_MODE", mode); vi.stubEnv("VERCEL", vercel);
    expect(isReadOnlyDeployment()).toBe(expected);
  });

  it.each(["/endpoints/new", "/endpoints/demo-healthy/edit", "/endpoints/demo-healthy/edit/"])("blocks management URL %s before rendering", async path => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    const response = proxy(new NextRequest(`https://demo.example.com${path}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["/", "/dashboard", "/endpoints/demo-healthy"])("blocks forged action POSTs to %s", async path => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    expect(proxy(new NextRequest(`https://demo.example.com${path}`, { method: "POST", headers: { "Next-Action": "forged" } })).status).toBe(403);
  });

  it("allows public reads and local management requests", () => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    expect(proxy(new NextRequest("https://demo.example.com/dashboard")).headers.get("x-middleware-next")).toBe("1");
    vi.stubEnv("APIPULSE_MODE", "local");
    expect(proxy(new NextRequest("https://demo.example.com/endpoints/new")).headers.get("x-middleware-next")).toBe("1");
  });

  it("blocks direct mutations and unrelated detail reads without touching the database", async () => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    expect(await saveEndpoint(prisma, {})).toMatchObject({ ok: false });
    expect(await setEndpointEnabled(prisma, "demo-healthy", false)).toMatchObject({ ok: false });
    expect(await getEndpoint(prisma, "private-endpoint")).toBeNull();
    expect(await getEndpointDetail(prisma, "private-endpoint")).toBeNull();
  });
});
