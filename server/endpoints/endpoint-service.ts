import "server-only";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { endpointIdSchema, endpointSchema } from "./validation";
import type { EndpointMutationResult } from "./types";
import { isReadOnlyDeployment, READ_ONLY_MESSAGE } from "../deployment";
import { DEMO_ENDPOINT_IDS } from "../demo/config";

const configurationSelect = {
  id: true, name: true, url: true, enabled: true, expectedStatusCode: true,
  timeoutMs: true, checkIntervalMinutes: true,
} as const;

export function listEndpoints(db: PrismaClient) {
  return db.endpoint.findMany({
    ...(isReadOnlyDeployment() ? { where: { id: { in: DEMO_ENDPOINT_IDS } } } : {}),
    select: configurationSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

export function getEndpoint(db: PrismaClient, id: string) {
  if (!endpointIdSchema.safeParse(id).success) return Promise.resolve(null);
  if (isReadOnlyDeployment() && !DEMO_ENDPOINT_IDS.includes(id)) return Promise.resolve(null);
  return db.endpoint.findUnique({ where: { id }, select: configurationSelect });
}

export async function saveEndpoint(db: PrismaClient, input: unknown, id?: string): Promise<EndpointMutationResult> {
  if (isReadOnlyDeployment()) return { ok: false, message: READ_ONLY_MESSAGE };
  const parsed = endpointSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: z.flattenError(parsed.error).fieldErrors };
  }
  if (id === undefined) {
    const row = await db.endpoint.create({ data: parsed.data, select: { id: true } });
    return { ok: true, id: row.id };
  }
  if (!endpointIdSchema.safeParse(id).success) return { ok: false, message: "Endpoint not found." };

  // UPDATE locks the same row as check persistence. Clearing ownership fences in-flight old configuration.
  const updated = await db.endpoint.updateMany({
    where: { id },
    data: { ...parsed.data, checkClaimToken: null, checkClaimExpiresAt: null },
  });
  return updated.count ? { ok: true, id } : { ok: false, message: "Endpoint not found. It may have been removed." };
}

export async function setEndpointEnabled(db: PrismaClient, id: unknown, enabled: unknown): Promise<EndpointMutationResult> {
  if (isReadOnlyDeployment()) return { ok: false, message: READ_ONLY_MESSAGE };
  const parsedId = endpointIdSchema.safeParse(id);
  if (!parsedId.success || typeof enabled !== "boolean") return { ok: false, message: "Invalid monitoring change." };
  const updated = await db.endpoint.updateMany({
    where: { id: parsedId.data },
    data: {
      enabled,
      ...(!enabled ? { checkClaimToken: null, checkClaimExpiresAt: null } : {}),
    },
  });
  return updated.count ? { ok: true, id: parsedId.data } : { ok: false, message: "Endpoint not found. Refresh the list." };
}
