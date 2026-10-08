import Link from "next/link";
import { Activity, Layers2, Radio } from "lucide-react";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="API Pulse home">
          <span className="brand-mark"><Activity size={22} strokeWidth={2.2} aria-hidden="true" /></span>
          <span>API Pulse</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/" className="nav-link" aria-current="page"><Radio size={16} aria-hidden="true" />Endpoints</Link>
        </nav>
        <span className="workspace-label"><Layers2 size={15} aria-hidden="true" />Workspace</span>
      </div>
    </header>
  );
}
