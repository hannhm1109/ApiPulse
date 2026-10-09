import Link from "next/link";
import { Activity, Layers2 } from "lucide-react";
import { AppNav } from "./app-nav";
import { isReadOnlyDeployment } from "../server/deployment";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="API Pulse home">
          <span className="brand-mark"><Activity size={22} strokeWidth={2.2} aria-hidden="true" /></span>
          <span>API Pulse</span>
        </Link>
        <AppNav />
        <span className="workspace-label"><Layers2 size={15} aria-hidden="true" />{isReadOnlyDeployment() ? "Public demo" : "Workspace"}</span>
      </div>
    </header>
  );
}
