import Link from "next/link";
import { ArrowLeft, Unplug } from "lucide-react";

export default function NotFound() {
  return <main className="page-container" id="main-content"><div className="empty-state">
    <Unplug size={28} aria-hidden="true" /><h1>Endpoint not found</h1>
    <Link href="/" className="button button-secondary"><ArrowLeft size={16} aria-hidden="true" />Back to endpoints</Link>
  </div></main>;
}
