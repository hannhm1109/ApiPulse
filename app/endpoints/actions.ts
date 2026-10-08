"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../../server/db/prisma";
import { saveEndpoint, setEndpointEnabled } from "../../server/endpoints/endpoint-service";
import { endpointFormInput } from "../../server/endpoints/validation";
import type { EndpointFormState, EndpointMutationResult } from "../../server/endpoints/types";

export async function saveEndpointAction(id: string | null, _previous: EndpointFormState, form: FormData): Promise<EndpointFormState> {
  let result: EndpointMutationResult;
  try {
    result = await saveEndpoint(prisma, endpointFormInput(form), id ?? undefined);
  } catch (error) {
    console.error(JSON.stringify({ event: "endpoint_save_error", error: error instanceof Error ? error.name : "UnknownError" }));
    return { message: "Could not save the endpoint. Please try again." };
  }
  if (!result.ok) return { errors: result.errors, message: result.message };
  revalidatePath("/");
  revalidatePath(`/endpoints/${result.id}/edit`);
  redirect("/");
}

export async function setEndpointEnabledAction(id: string, enabled: boolean): Promise<EndpointMutationResult> {
  try {
    const result = await setEndpointEnabled(prisma, id, enabled);
    if (result.ok) {
      revalidatePath("/");
      revalidatePath(`/endpoints/${result.id}/edit`);
    }
    return result;
  } catch (error) {
    console.error(JSON.stringify({ event: "endpoint_toggle_error", error: error instanceof Error ? error.name : "UnknownError" }));
    return { ok: false, message: "Could not change monitoring. Please try again." };
  }
}
