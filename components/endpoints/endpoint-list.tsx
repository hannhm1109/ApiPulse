"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, Plus, Radio, RefreshCw, Search, X } from "lucide-react";
import type { EndpointListItem } from "../../server/endpoints/types";
import { MonitoringSwitch } from "./monitoring-switch";

export function EndpointList({ endpoints, readOnly }: { endpoints: EndpointListItem[]; readOnly: boolean }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const query = search.trim().toLowerCase();
  const filtered = endpoints.filter(endpoint => (
    (filter === "all" || endpoint.enabled === (filter === "enabled")) &&
    (!query || endpoint.name.toLowerCase().includes(query) || endpoint.url.toLowerCase().includes(query))
  ));
  return (
    <>
      <div className="list-toolbar">
        <div className="search-field"><Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Search endpoints" placeholder="Search endpoints..." value={search} onChange={event => setSearch(event.target.value)} />
          <button type="button" className="search-clear icon-button" aria-label="Clear search" disabled={!search} onClick={() => setSearch("")}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <select aria-label="Filter monitoring" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All monitoring</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
        </select>
        <div className="toolbar-end">
          <span className="result-count">{filtered.length} {filtered.length === 1 ? "endpoint" : "endpoints"}</span>
          <span className="tooltip"><button className="icon-button" type="button" disabled={pending} aria-label="Refresh endpoints"
            onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} className={pending ? "spin" : ""} aria-hidden="true" /></button>
            <span className="tooltip-text" role="tooltip">Refresh endpoints</span>
          </span>
        </div>
      </div>
      {filtered.length ? <table className="endpoint-table">
        <caption className="sr-only">Monitored endpoint configuration</caption>
        <thead><tr><th scope="col">Endpoint</th><th scope="col">Expected</th><th scope="col">Timeout</th><th scope="col">Interval</th><th scope="col">Monitoring</th>{!readOnly && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{filtered.map(endpoint => <tr key={endpoint.id}>
          <th scope="row" className="endpoint-identity">
            <div className="endpoint-name-line"><span className="method-badge">GET</span><Link href={`/endpoints/${endpoint.id}`} className="endpoint-name">{endpoint.name}</Link></div>
            <span className="endpoint-url mono">{endpoint.url}</span>
          </th>
          <td><span className="mobile-label">Expected</span><span className="status-code mono">{endpoint.expectedStatusCode}</span></td>
          <td><span className="mobile-label">Timeout</span><span className="numeric">{endpoint.timeoutMs.toLocaleString("en-US")}</span> <span className="muted">ms</span></td>
          <td><span className="mobile-label">Interval</span><span className="numeric">{endpoint.checkIntervalMinutes}</span> <span className="muted">min</span></td>
          <td>{readOnly ? <><span className="mobile-label">Monitoring</span>{endpoint.enabled ? "Enabled" : "Disabled"}</>
            : <MonitoringSwitch id={endpoint.id} name={endpoint.name} enabled={endpoint.enabled} />}</td>
          {!readOnly && <td className="row-action"><span className="tooltip"><Link className="icon-button" href={`/endpoints/${endpoint.id}/edit`} aria-label={`Edit ${endpoint.name}`}>
            <ArrowUpRight size={18} aria-hidden="true" /></Link><span role="tooltip" className="tooltip-text">Edit endpoint</span></span></td>}
        </tr>)}</tbody>
      </table> : <div className="empty-state">
        {endpoints.length ? <Search size={28} aria-hidden="true" /> : <Radio size={28} aria-hidden="true" />}
        <h2>{endpoints.length ? "No matching endpoints" : "No endpoints yet"}</h2>
        {endpoints.length ? <button className="button button-secondary" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>
          : !readOnly && <Link className="button button-primary" href="/endpoints/new"><Plus size={16} aria-hidden="true" />Add endpoint</Link>}
      </div>}
    </>
  );
}
