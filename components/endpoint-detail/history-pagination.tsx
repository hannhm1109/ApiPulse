import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HistoryOptions, HistoryPage } from "../../server/endpoint-detail/types";
import { detailHref } from "../../server/endpoint-detail/history-metrics";

export function HistoryPagination({ id, options, history, section }: {
  id: string; options: HistoryOptions; history: Omit<HistoryPage<unknown>, "items">; section: "checks" | "incidents";
}) {
  if (history.pages <= 1) return null;
  const key = section === "checks" ? "checkPage" : "incidentPage";
  return <nav className="history-pagination" aria-label={`${section === "checks" ? "Check" : "Incident"} history pages`}>
    <span className="muted">Page {history.page} of {history.pages}</span>
    <span className="pagination-buttons">
      {history.page > 1 ? <span className="tooltip"><Link className="icon-button" aria-label={`Previous ${section} page`} href={detailHref(id, { ...options, [key]: history.page - 1 }, section)}>
        <ChevronLeft size={18} aria-hidden="true" /></Link><span role="tooltip" className="tooltip-text">Previous page</span></span>
        : <button type="button" className="icon-button" disabled aria-label={`Previous ${section} page`}><ChevronLeft size={18} aria-hidden="true" /></button>}
      {history.page < history.pages ? <span className="tooltip"><Link className="icon-button" aria-label={`Next ${section} page`} href={detailHref(id, { ...options, [key]: history.page + 1 }, section)}>
        <ChevronRight size={18} aria-hidden="true" /></Link><span role="tooltip" className="tooltip-text">Next page</span></span>
        : <button type="button" className="icon-button" disabled aria-label={`Next ${section} page`}><ChevronRight size={18} aria-hidden="true" /></button>}
    </span>
  </nav>;
}
