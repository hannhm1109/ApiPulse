"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { DashboardCheck } from "../../server/dashboard/types";
import { latencySeries, responseLatency } from "../../server/endpoint-detail/history-metrics";
import { utcDateTime } from "../../lib/display-time";

export function LatencyChart({ checks }: { checks: DashboardCheck[] }) {
  const container = useRef<HTMLDivElement>(null);
  const series = latencySeries(checks);
  const hasResponse = series[1].some(value => value != null);
  const canPlot = series[0].length >= 2 && hasResponse;

  useEffect(() => {
    if (!container.current || !canPlot) return;
    const host = container.current;
    const chart = new uPlot({
      width: Math.max(240, host.clientWidth), height: 260,
      tzDate: timestamp => uPlot.tzDate(new Date(timestamp * 1000), "UTC"),
      cursor: { drag: { x: false, y: false } },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      legend: { show: true },
      scales: { y: { range: (_chart, _min, max) => [0, Math.max(10, (max ?? 0) * 1.15)] } },
      axes: [
        { stroke: "#697079", grid: { show: false }, font: "11px sans-serif", space: 90 },
        { stroke: "#697079", grid: { stroke: "#e1e3e8", width: 1 }, font: "11px sans-serif", size: 54,
          values: (_chart, values) => values.map(value => `${value} ms`) },
      ],
      series: [
        { label: "UTC", value: (_chart, value) => value == null ? "--" : utcDateTime(new Date(value * 1000).toISOString()) },
        { label: "Response", stroke: "#4163dc", width: 2, spanGaps: false,
          points: { show: true, size: 5, fill: "#4163dc" }, value: (_chart, value) => value == null ? "--" : `${value} ms` },
      ],
    }, latencySeries(checks), host);
    const observer = new ResizeObserver(() => chart.setSize({ width: Math.max(240, host.clientWidth), height: 260 }));
    observer.observe(host);
    return () => { observer.disconnect(); chart.destroy(); };
  }, [checks, canPlot]);

  return <>
    {canPlot ? <div className="latency-plot" role="img" aria-label={`Response latency in milliseconds over time, ${series[0].length} observations, UTC`}>
      <div ref={container} aria-hidden="true" />
    </div> : <div className="chart-empty">{checks.length === 0 ? "No checks in this period" : !hasResponse ? "No response timings in this period" :
      <>One response observation <strong>{series[1].find(value => value != null)} ms</strong></>}</div>}
    {checks.length > 0 && <details className="chart-data"><summary>Latency observations</summary>
      <table className="history-table chart-data-table"><caption className="sr-only">Chart observations, newest first</caption>
        <thead><tr><th scope="col">Checked at (UTC)</th><th scope="col">Result</th><th scope="col">Response</th></tr></thead>
        <tbody>{checks.map(check => <tr key={check.id}><td><time dateTime={check.checkedAt}>{utcDateTime(check.checkedAt)}</time></td>
          <td>{check.status}</td><td>{responseLatency(check) == null ? "--" : `${responseLatency(check)} ms`}</td></tr>)}</tbody>
      </table>
    </details>}
  </>;
}
