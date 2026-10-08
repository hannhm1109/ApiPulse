"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, Circle, Clock3, Layers2, Plus, Radio, RefreshCw, Search, X } from "lucide-react";
import type { DashboardData, HealthState } from "../../server/dashboard/types";
import { formatDuration, relativeTime, utcTime } from "../../lib/display-time";
import { CheckHistory } from "./check-history";

const healthLabels: Record<HealthState, string> = { UP: "Up", DOWN: "Down", PENDING: "Pending", STALE: "Stale", DISABLED: "Disabled", UNKNOWN: "Unknown" };

export function DashboardView({ data }: { data: DashboardData }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const query = search.trim().toLowerCase();
  const endpoints = data.endpoints.filter(endpoint => (filter === "all" || endpoint.health === filter) &&
    (!query || endpoint.name.toLowerCase().includes(query) || endpoint.url.toLowerCase().includes(query)));

  return <>
    <div className="page-heading dashboard-heading"><h1>Dashboard</h1>
      <div className="dashboard-heading-actions">
        <time className="snapshot-time muted" dateTime={data.generatedAt} title={data.generatedAt}>Updated {utcTime(data.generatedAt)} UTC</time>
        <span className="tooltip"><button type="button" className="icon-button refresh-dashboard" aria-label="Refresh dashboard" disabled={pending}
          onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} className={pending ? "spin" : ""} aria-hidden="true" /></button>
          <span role="tooltip" className="tooltip-text">Refresh dashboard</span>
        </span>
        <Link href="/endpoints/new" className="button button-primary"><Plus size={16} aria-hidden="true" />Add endpoint</Link>
      </div>
    </div>
    <dl className="dashboard-metrics" aria-label="Monitoring summary">
      <div><dt><Layers2 size={15} aria-hidden="true" />Total endpoints</dt><dd>{data.counts.total}</dd></div>
      <div><dt><CheckCircle2 size={15} aria-hidden="true" />Healthy</dt><dd className="metric-healthy">{data.counts.healthy}</dd></div>
      <div><dt><AlertCircle size={15} aria-hidden="true" />Down</dt><dd className="metric-down">{data.counts.down}</dd></div>
      <div><dt><Radio size={15} aria-hidden="true" />Active incidents</dt><dd className={data.counts.activeIncidents ? "metric-down" : ""}>{data.counts.activeIncidents}</dd></div>
    </dl>
    <div className="observation-counts" aria-label="Other endpoint states">
      <span>{data.counts.pending} pending</span><span>{data.counts.stale} stale</span>
      <span>{data.counts.disabled} disabled</span>{data.counts.unknown > 0 && <span>{data.counts.unknown} unknown</span>}
    </div>

    <section className="dashboard-section incident-section" aria-labelledby="incidents-heading">
      <div className="section-heading"><h2 id="incidents-heading">Active incidents</h2><span className="heading-count">{data.incidents.length}</span></div>
      {data.incidents.length ? <ul className="active-incident-list">
        {data.incidents.map(incident => <li key={incident.id}>
          <AlertCircle size={17} className="incident-icon" aria-hidden="true" />
          <div className="incident-identity"><Link href={`/endpoints/${incident.endpointId}/edit`} className="endpoint-name">{incident.endpointName}</Link>
            <p className="incident-cause">{incident.cause}</p>
          </div>
          {!incident.enabled && <span className="incident-disabled">Monitoring disabled</span>}
          <div className="incident-age"><span className="incident-open">Open</span>
            <time dateTime={incident.startedAt} title={incident.startedAt}>{formatDuration(Date.parse(data.generatedAt) - Date.parse(incident.startedAt))}</time>
          </div>
          <span className="tooltip"><Link href={`/endpoints/${incident.endpointId}/edit`} className="icon-button" aria-label={`Edit settings for ${incident.endpointName}`}>
            <ArrowUpRight size={17} aria-hidden="true" /></Link><span className="tooltip-text" role="tooltip">Endpoint settings</span></span>
        </li>)}
      </ul> : <p className="no-incidents">No active incidents</p>}
    </section>

    <section className="dashboard-section" aria-labelledby="health-heading" aria-busy={pending}>
      <div className="section-heading"><h2 id="health-heading">Endpoint health</h2></div>
      <div className="list-toolbar">
        <div className="search-field"><Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Search dashboard endpoints" placeholder="Search endpoints..." value={search} onChange={event => setSearch(event.target.value)} />
          <button type="button" className="search-clear icon-button" aria-label="Clear dashboard search" disabled={!search} onClick={() => setSearch("")}><X size={15} aria-hidden="true" /></button>
        </div>
        <select aria-label="Filter endpoint health" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All states</option>{Object.entries(healthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className="toolbar-end result-count">{endpoints.length} {endpoints.length === 1 ? "endpoint" : "endpoints"}</span>
      </div>
      {endpoints.length ? <table className="endpoint-table dashboard-table">
        <caption className="sr-only">Endpoint health and latest monitoring observations</caption>
        <thead><tr><th scope="col">Endpoint</th><th scope="col">Status</th><th scope="col">Latency</th><th scope="col">Last checked</th><th scope="col">Recent checks</th><th scope="col"><span className="sr-only">Settings</span></th></tr></thead>
        <tbody>{endpoints.map(endpoint => <tr key={endpoint.id}>
          <th scope="row" className="endpoint-identity"><div className="endpoint-name-line"><span className="method-badge">GET</span>
            <Link href={`/endpoints/${endpoint.id}/edit`} className="endpoint-name">{endpoint.name}</Link></div><span className="endpoint-url mono">{endpoint.url}</span>
          </th>
          <td><span className="mobile-label">Status</span><HealthBadge health={endpoint.health} /></td>
          <td><span className="mobile-label">Latency</span><span className="numeric" title={endpoint.latencyMs == null ? "No response timing" : undefined}>
            {endpoint.latencyMs == null ? "--" : <>{endpoint.latencyMs.toLocaleString("en-US")} <span className="muted">ms</span></>}
          </span></td>
          <td><span className="mobile-label">Last checked</span>{endpoint.latestCheck
            ? <time dateTime={endpoint.latestCheck.checkedAt} title={endpoint.latestCheck.checkedAt}>{relativeTime(endpoint.latestCheck.checkedAt, data.generatedAt)}</time>
            : <span className="muted">Never</span>}
          </td>
          <td><span className="mobile-label">Recent checks</span><CheckHistory checks={endpoint.recentChecks} /></td>
          <td className="row-action"><span className="tooltip"><Link href={`/endpoints/${endpoint.id}/edit`} className="icon-button" aria-label={`Edit ${endpoint.name}`}>
            <ArrowUpRight size={18} aria-hidden="true" /></Link><span className="tooltip-text" role="tooltip">Endpoint settings</span></span></td>
        </tr>)}</tbody>
      </table> : <div className="empty-state"><Radio size={28} aria-hidden="true" /><h2>{data.endpoints.length ? "No matching endpoints" : "No endpoints yet"}</h2>
        {data.endpoints.length ? <button type="button" className="button button-secondary" onClick={() => { setFilter("all"); setSearch(""); }}>Clear filters</button>
          : <Link href="/endpoints/new" className="button button-primary"><Plus size={16} aria-hidden="true" />Add endpoint</Link>}
      </div>}
    </section>
  </>;
}

function HealthBadge({ health }: { health: HealthState }) {
  const Icon = health === "UP" ? CheckCircle2 : health === "DOWN" ? AlertCircle : health === "STALE" ? Clock3 : Circle;
  return <span className={`health-badge health-${health.toLowerCase()}`}><Icon size={13} aria-hidden="true" />{healthLabels[health]}</span>;
}
