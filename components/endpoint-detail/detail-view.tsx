import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Settings2 } from "lucide-react";
import type { EndpointDetailData, HistoryPeriod } from "../../server/endpoint-detail/types";
import { detailHref, periodLabels, responseLatency } from "../../server/endpoint-detail/history-metrics";
import { formatDuration, relativeTime, utcDateTime, utcTime } from "../../lib/display-time";
import { HealthBadge } from "../health-badge";
import { LatencyChart } from "./latency-chart";
import { RefreshDetail } from "./refresh-detail";
import { HistoryPagination } from "./history-pagination";
import { CopyUrl } from "./copy-url";

const milliseconds = (value: number | null) => value == null ? "--" : `${Math.round(value).toLocaleString("en-US")} ms`;

export function DetailView({ data, readOnly }: { data: EndpointDetailData; readOnly: boolean }) {
  const { endpoint, options, metrics, latestCheck } = data;
  return <main className="page-container detail-page" id="main-content">
    <Link href="/dashboard" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Dashboard</Link>
    <div className="detail-heading">
      <div className="detail-identity"><div className="detail-title"><h1>{endpoint.name}</h1><HealthBadge health={data.health} /></div>
        <p className="detail-url mono"><span className="method-badge">GET</span>{endpoint.url}</p></div>
      <div className="detail-actions"><time className="snapshot-time muted" dateTime={data.generatedAt} title={data.generatedAt}>Updated {utcTime(data.generatedAt)} UTC</time>
        <CopyUrl url={endpoint.url} /><RefreshDetail />{!readOnly && <Link href={`/endpoints/${endpoint.id}/edit`} className="button button-secondary"><Settings2 size={16} aria-hidden="true" />Settings</Link>}
      </div>
    </div>
    <div className="detail-configuration"><span>Expected <strong>{endpoint.expectedStatusCode}</strong></span><span>Timeout <strong>{endpoint.timeoutMs.toLocaleString("en-US")} ms</strong></span>
      <span>Interval <strong>{endpoint.checkIntervalMinutes} min</strong></span><span>Monitoring <strong>{endpoint.enabled ? "enabled" : "disabled"}</strong></span></div>
    {data.activeIncident && <div className="detail-active-incident" role="status"><AlertCircle size={18} aria-hidden="true" />
      <div><strong>Incident open</strong><p>{data.activeIncident.cause}</p></div>
      <span>{data.activeIncident.durationMs == null ? "--" : formatDuration(data.activeIncident.durationMs)}</span></div>}

    <nav className="detail-jump-nav" aria-label="Endpoint sections"><a href="#overview">Overview</a><a href="#latency">Latency</a><a href="#checks">Checks</a><a href="#incidents">Incidents</a></nav>

    <div className="detail-period-bar" id="overview"><h2>Health overview</h2>
      <nav className="period-control" aria-label="History period">{(Object.keys(periodLabels) as HistoryPeriod[]).map(period =>
        <Link key={period} href={detailHref(endpoint.id, { period, checkPage: 1, incidentPage: 1 })} aria-current={options.period === period ? "true" : undefined}>
          {periodLabels[period]}</Link>)}</nav>
    </div>
    <dl className="dashboard-metrics detail-metrics" aria-label="Endpoint health overview">
      <div><dt>Check-based uptime</dt><dd className={metrics.uptimePercent === 100 ? "metric-healthy" : ""}>{metrics.uptimePercent == null ? "--" : `${metrics.uptimePercent.toFixed(2)}%`}</dd>
        <span className="metric-caption">{periodLabels[options.period]}</span></div>
      <div><dt>Average response</dt><dd>{milliseconds(metrics.averageLatencyMs)}</dd><span className="metric-caption">{metrics.responseCount.toLocaleString("en-US")} measured responses</span></div>
      <div><dt>Latest response</dt><dd>{milliseconds(data.latencyMs)}</dd><span className="metric-caption">{latestCheck ? latestCheck.status.toLowerCase() : "No checks yet"}</span></div>
      <div><dt>Last checked</dt><dd className="last-checked-value">{latestCheck ? <time dateTime={latestCheck.checkedAt} title={latestCheck.checkedAt}>{relativeTime(latestCheck.checkedAt, data.generatedAt)}</time> : "Never"}</dd>
        <span className="metric-caption">Latest observation</span></div>
    </dl>
    <div className="observation-counts detail-check-counts"><span>{metrics.total.toLocaleString("en-US")} completed checks</span><span>{metrics.successful.toLocaleString("en-US")} successful</span>
      <span>{metrics.failed.toLocaleString("en-US")} failed</span><span>{metrics.timedOut.toLocaleString("en-US")} timed out</span></div>

    <section className="dashboard-section" id="latency" aria-labelledby="latency-heading"><div className="section-heading detail-section-heading"><h2 id="latency-heading">Latency history</h2>
      <span className="muted">Latest {data.chartChecks.length} checks</span></div><LatencyChart checks={data.chartChecks} /></section>

    <section className="dashboard-section" id="checks" aria-labelledby="checks-heading"><div className="section-heading detail-section-heading"><h2 id="checks-heading">Check history</h2>
      <span className="muted">{periodLabels[options.period]}</span></div>
      {data.checks.items.length ? <table className="history-table check-table"><caption className="sr-only">Check history for {endpoint.name}</caption>
        <thead><tr><th scope="col">Checked at (UTC)</th><th scope="col">Result</th><th scope="col">HTTP</th><th scope="col">Response</th><th scope="col">Failure reason</th></tr></thead>
        <tbody>{data.checks.items.map(check => <tr key={check.id}>
          <th scope="row"><span className="mobile-label">Checked at (UTC)</span><time dateTime={check.checkedAt}>{utcDateTime(check.checkedAt)}</time></th>
          <td><span className="mobile-label">Result</span><span className={`check-result result-${check.status.toLowerCase()}`}>{check.status === "SUCCESS" && <CheckCircle2 size={13} aria-hidden="true" />}
            {check.status === "SUCCESS" ? "Success" : check.status === "TIMEOUT" ? "Timeout" : "Failure"}</span></td>
          <td><span className="mobile-label">HTTP</span>{check.statusCode == null ? "--" : <span className="status-code mono">{check.statusCode}</span>}</td>
          <td><span className="mobile-label">Response</span><span className="response-latency">{milliseconds(responseLatency(check))}</span></td>
          <td className="history-reason"><span className="mobile-label">Failure reason</span>{check.failureReason ?? "--"}</td>
        </tr>)}</tbody></table> : <p className="no-incidents">No checks in this period</p>}
      <HistoryPagination id={endpoint.id} options={options} history={data.checks} section="checks" />
    </section>

    <section className="dashboard-section" id="incidents" aria-labelledby="incident-history-heading"><div className="section-heading detail-section-heading"><h2 id="incident-history-heading">Incident history</h2>
      <span className="muted">All time, {data.incidents.total} {data.incidents.total === 1 ? "incident" : "incidents"}</span></div>
      {data.incidents.items.length ? <table className="history-table incident-history-table"><caption className="sr-only">Incident history for {endpoint.name}</caption>
        <thead><tr><th scope="col">Started (UTC)</th><th scope="col">Status</th><th scope="col">Resolved (UTC)</th><th scope="col">Duration</th><th scope="col">Cause</th></tr></thead>
        <tbody>{data.incidents.items.map(incident => <tr key={incident.id}>
          <th scope="row"><span className="mobile-label">Started (UTC)</span><time dateTime={incident.startedAt}>{utcDateTime(incident.startedAt)}</time></th>
          <td><span className="mobile-label">Status</span><span className={`incident-state incident-${incident.status.toLowerCase()}`}>{incident.status === "OPEN" ? "Open" : "Resolved"}</span></td>
          <td><span className="mobile-label">Resolved (UTC)</span>{incident.resolvedAt ? <time dateTime={incident.resolvedAt}>{utcDateTime(incident.resolvedAt)}</time> : "--"}</td>
          <td><span className="mobile-label">Duration</span>{incident.durationMs == null ? "--" : formatDuration(incident.durationMs)}</td>
          <td className="history-reason"><span className="mobile-label">Cause</span>{incident.cause}</td>
        </tr>)}</tbody></table> : <p className="no-incidents">No incidents recorded</p>}
      <HistoryPagination id={endpoint.id} options={options} history={data.incidents} section="incidents" />
    </section>
  </main>;
}
