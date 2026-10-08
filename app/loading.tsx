export default function Loading() {
  return <main className="page-container" id="main-content" aria-busy="true" aria-label="Loading endpoints">
    <div className="skeleton skeleton-heading" />
    <div className="skeleton skeleton-toolbar" />
    {[1, 2, 3].map(row => <div key={row} className="skeleton skeleton-row" />)}
    <span className="sr-only" role="status">Loading endpoints...</span>
  </main>;
}
