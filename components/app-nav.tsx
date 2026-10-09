"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Globe2, LayoutDashboard, Radio } from "lucide-react";

export function AppNav() {
  const pathname = usePathname();
  return <nav aria-label="Main navigation">
    <Link href="/dashboard" className="nav-link" aria-current={pathname.startsWith("/dashboard") ? "page" : undefined}>
      <LayoutDashboard size={16} aria-hidden="true" />Dashboard
    </Link>
    <Link href="/" className="nav-link" aria-current={pathname === "/" || pathname.startsWith("/endpoints") ? "page" : undefined}>
      <Radio size={16} aria-hidden="true" />Endpoints
    </Link>
  </nav>;
}

export function AppContext({ readOnly }: { readOnly: boolean }) {
  const pathname = usePathname();
  const section = pathname.startsWith("/dashboard") ? "Dashboard" : "Endpoints";
  const detail = pathname === "/endpoints/new" ? "New endpoint" : pathname.endsWith("/edit") ? "Settings" : pathname.startsWith("/endpoints/") ? "Endpoint detail" : null;

  return <div className="workspace-bar">
    <div className="workspace-breadcrumb"><span className="breadcrumb-root">Monitor</span><ChevronRight size={13} aria-hidden="true" /><span>{section}</span>
      {detail && <><ChevronRight size={13} aria-hidden="true" /><span className="breadcrumb-detail">{detail}</span></>}
    </div>
    <span className="context-mode"><Globe2 size={13} aria-hidden="true" />{readOnly ? "Public demo" : "Workspace"}<span className="context-timezone">UTC</span></span>
  </div>;
}
