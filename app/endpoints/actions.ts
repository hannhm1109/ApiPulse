"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../../server/db/prisma";
import { saveEndpoint, setEndpointEnabled } from "../../server/endpoints/endpoint-service";
import { endpointFormInput } from "../../server/endpoints/validation";
import type { EndpointFormState, EndpointMutationResult } from "../../server/endpoints/types";
import { logServerError } from "../../server/logging";
import { isReadOnlyDeployment, READ_ONLY_MESSAGE } from "../../server/deployment";

export async function saveEndpointAction(id: string | null, _previous: EndpointFormState, form: FormData): Promise<EndpointFormState> {
  if (isReadOnlyDeployment()) return { message: READ_ONLY_MESSAGE };
  let result: EndpointMutationResult;
  try {
    result = await saveEndpoint(prisma, endpointFormInput(form), id ?? undefined);
  } catch (error) {
    logServerError("endpoint_save_error", error);
    return { message: "Could not save the endpoint. Please try again." };
  }
  if (!result.ok) return { errors: result.errors, message: result.message };
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath(`/endpoints/${result.id}`);
  revalidatePath(`/endpoints/${result.id}/edit`);
  redirect("/");
}

export async function setEndpointEnabledAction(id: string, enabled: boolean): Promise<EndpointMutationResult> {
  if (isReadOnlyDeployment()) return { ok: false, message: READ_ONLY_MESSAGE };
  try {
    const result = await setEndpointEnabled(prisma, id, enabled);
    if (result.ok) {
      revalidatePath("/");
      revalidatePath("/dashboard");
      revalidatePath(`/endpoints/${result.id}`);
      revalidatePath(`/endpoints/${result.id}/edit`);
    }
    return result;
  } catch (error) {
    logServerError("endpoint_toggle_error", error);
    return { ok: false, message: "Could not change monitoring. Please try again." };
  }
}
