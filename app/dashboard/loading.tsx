export default function LoadingDashboard() {
  return <main className="page-container" id="main-content" aria-busy="true" aria-label="Loading dashboard">
    <div className="skeleton skeleton-heading" /><div className="skeleton dashboard-skeleton-metrics" />
    <div className="skeleton skeleton-toolbar" />{[1, 2, 3].map(row => <div key={row} className="skeleton skeleton-row" />)}
    <span className="sr-only" role="status">Loading dashboard...</span>
  </main>;
}
