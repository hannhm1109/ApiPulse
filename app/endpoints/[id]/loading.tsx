export default function LoadingEndpoint() {
  return <main className="page-container" id="main-content" aria-busy="true" aria-label="Loading endpoint">
    <div className="skeleton skeleton-heading" /><div className="skeleton dashboard-skeleton-metrics" />
    <div className="skeleton detail-skeleton-chart" /><div className="skeleton skeleton-row" />
    <span className="sr-only" role="status">Loading endpoint...</span>
  </main>;
}
