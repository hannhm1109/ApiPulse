"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Radio } from "lucide-react";

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
