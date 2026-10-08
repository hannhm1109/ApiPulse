"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Save } from "lucide-react";
import { saveEndpointAction } from "../../app/endpoints/actions";
import type { EndpointField, EndpointFormState, EndpointListItem } from "../../server/endpoints/types";

const defaults = { name: "", url: "", expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5, enabled: true };

export function EndpointForm({ endpoint }: { endpoint?: EndpointListItem }) {
  const initial = endpoint ?? defaults;
  const [values, setValues] = useState({ ...initial,
    expectedStatusCode: String(initial.expectedStatusCode), timeoutMs: String(initial.timeoutMs),
    checkIntervalMinutes: String(initial.checkIntervalMinutes),
  });
  const [state, action, pending] = useActionState<EndpointFormState, FormData>(
    saveEndpointAction.bind(null, endpoint?.id ?? null), {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const first = state.errors && Object.keys(state.errors)[0];
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  }, [state]);

  function fieldProps(field: EndpointField) {
    return {
      id: field, name: field, "aria-invalid": !!state.errors?.[field],
      "aria-describedby": state.errors?.[field]?.length ? `${field}-error` : undefined,
    };
  }
  const change = (field: Exclude<EndpointField, "enabled">, value: string) => setValues(current => ({ ...current, [field]: value }));

  return (
    <form action={action} ref={formRef} className="endpoint-form" noValidate aria-busy={pending}>
      {state.message && <div className="form-alert" role="alert">{state.message}</div>}
      <fieldset disabled={pending} className="form-section">
        <legend>Endpoint</legend>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input {...fieldProps("name")} autoComplete="off" required maxLength={80}
            placeholder="Payments API" value={values.name} onChange={event => change("name", event.target.value)} />
          <FieldError field="name" state={state} />
        </div>
        <div className="field">
          <label htmlFor="url">URL <span className="field-tag">GET</span></label>
          <input {...fieldProps("url")} type="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
            required maxLength={2048} placeholder="https://api.example.com/health" className="mono"
            value={values.url} onChange={event => change("url", event.target.value)} />
          <FieldError field="url" state={state} />
        </div>
      </fieldset>
      <fieldset disabled={pending} className="form-section">
        <legend>Check settings</legend>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="expectedStatusCode">Expected status</label>
            <input {...fieldProps("expectedStatusCode")} type="number" inputMode="numeric" required min={100} max={599} step={1}
              value={values.expectedStatusCode} onChange={event => change("expectedStatusCode", event.target.value)} />
            <FieldError field="expectedStatusCode" state={state} />
          </div>
          <div className="field">
            <label htmlFor="timeoutMs">Timeout <span className="unit-label">ms</span></label>
            <input {...fieldProps("timeoutMs")} type="number" inputMode="numeric" required min={1} max={30000} step={1}
              value={values.timeoutMs} onChange={event => change("timeoutMs", event.target.value)} />
            <FieldError field="timeoutMs" state={state} />
          </div>
          <div className="field">
            <label htmlFor="checkIntervalMinutes">Check interval <span className="unit-label">min</span></label>
            <input {...fieldProps("checkIntervalMinutes")} type="number" inputMode="numeric" required min={1} max={1440} step={1}
              value={values.checkIntervalMinutes} onChange={event => change("checkIntervalMinutes", event.target.value)} />
            <FieldError field="checkIntervalMinutes" state={state} />
          </div>
        </div>
      </fieldset>
      <fieldset disabled={pending} className="monitoring-fieldset">
        <legend className="sr-only">Monitoring</legend>
        <label className="monitoring-setting" htmlFor="enabled">
          <span>Monitoring <span className="setting-value">{values.enabled ? "Enabled" : "Disabled"}</span></span>
          <span className="switch"><input {...fieldProps("enabled")} type="checkbox" role="switch"
            checked={values.enabled} onChange={event => setValues(current => ({ ...current, enabled: event.target.checked }))} />
            <span className="switch-track" aria-hidden="true"><span /></span>
          </span>
        </label>
        <FieldError field="enabled" state={state} />
      </fieldset>
      <div className="form-actions">
        <Link href="/" className="button button-secondary" aria-disabled={pending} tabIndex={pending ? -1 : undefined}>Cancel</Link>
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : endpoint ? <Save size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {pending ? "Saving..." : endpoint ? "Save changes" : "Create endpoint"}
        </button>
      </div>
    </form>
  );
}

function FieldError({ field, state }: { field: EndpointField; state: EndpointFormState }) {
  return state.errors?.[field]?.length ? <p id={`${field}-error`} className="field-error">{state.errors[field]![0]}</p> : null;
}
