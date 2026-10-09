import { NextRequest, NextResponse } from "next/server";
import { resolveShareToken } from "@/lib/brief-share";
import { loadBriefData } from "@/lib/brief";
import { renderBriefPdf } from "@/lib/brief-pdf";
import { briefFileName } from "@/lib/brief-content";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new NextResponse("This link is invalid, expired or has been revoked.", { status: 404, headers: noStore });

/** Public (no login) but signed, expiring and revocable. Always renders the CURRENT task content. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`share:${ip}`, 30, 60_000)) return new NextResponse("Too many requests.", { status: 429, headers: noStore });
  const scope = await resolveShareToken((await params).token);
  if (!scope) return notFound();
  const loaded = await loadBriefData(scope);
  if (!loaded) return notFound();
  const pdf = await renderBriefPdf(loaded.data);
  const disp = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: { ...noStore, "Content-Type": "application/pdf", "Content-Disposition": `${disp}; filename="${briefFileName(loaded.task.taskCode)}"`, "X-Content-Type-Options": "nosniff" },
  });
}
