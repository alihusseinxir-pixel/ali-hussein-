import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients / same-origin GET-like navigations
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
