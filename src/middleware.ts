import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/register", "/invite", "/share", "/api/cron", "/api/health", "/forgot-password", "/reset-password"];

// Cheap gate only (cookie presence). Real verification happens in getCurrentUser() on every page/action.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/" || PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isPublic && !req.cookies.get("basma_session")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Routes that hand out signed/secret links set their own stricter policy (no-referrer); do not override it.
  if (!pathname.startsWith("/api/files/") && !pathname.startsWith("/share/")) res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
