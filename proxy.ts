import { NextResponse, type NextRequest } from "next/server";
import { isReadOnlyDeployment } from "./server/deployment";

export function proxy(request: NextRequest) {
  if (!isReadOnlyDeployment()) return NextResponse.next();
  const headers = { "Cache-Control": "no-store" };
  if (!["GET", "HEAD"].includes(request.method)) {
    return NextResponse.json({ error: "Public demo is read-only" }, { status: 403, headers });
  }
  if (request.nextUrl.pathname === "/endpoints/new" || /^\/endpoints\/[^/]+\/edit\/?$/.test(request.nextUrl.pathname)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/dashboard/:path*", "/endpoints/:path*"] };
