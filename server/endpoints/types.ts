export type EndpointValues = {
  name: string;
  url: string;
  expectedStatusCode: number;
  timeoutMs: number;
  checkIntervalMinutes: number;
  enabled: boolean;
};

export type EndpointField = keyof EndpointValues;
export type EndpointFormState = {
  errors?: Partial<Record<EndpointField, string[]>>;
  message?: string;
};
export type EndpointListItem = EndpointValues & { id: string };
export type EndpointMutationResult =
  | { ok: true; id: string }
  | { ok: false; errors?: EndpointFormState["errors"]; message: string };
