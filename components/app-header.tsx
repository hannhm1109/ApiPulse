import Link from "next/link";
import { AudioLines, LockKeyhole, Monitor } from "lucide-react";
import { AppNav } from "./app-nav";
import { isReadOnlyDeployment } from "../server/deployment";

export function AppHeader() {
  const readOnly = isReadOnlyDeployment();
  return (
    <header className="app-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="API Pulse home">
          <span className="brand-mark"><AudioLines size={24} strokeWidth={2} aria-hidden="true" /></span>
          <span>API Pulse</span>
        </Link>
        <span className="nav-caption">Monitoring</span>
        <AppNav />
        <div className="rail-footer">
          <span className="workspace-label">{readOnly ? <LockKeyhole size={16} aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}{readOnly ? "Public demo" : "Workspace"}</span>
          <span className="rail-mode">{readOnly ? "Read only" : "Local management"}</span>
        </div>
      </div>
    </header>
  );
}
