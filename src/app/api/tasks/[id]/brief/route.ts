import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { loadBriefData } from "@/lib/brief";
import { renderBriefPdf } from "@/lib/brief-pdf";
import { briefFileName } from "@/lib/brief-content";
import { json } from "@/lib/api-guard";

export const runtime = "nodejs";

/** GET /api/tasks/:id/brief  → PDF (inline by default, ?download=1 forces download). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const loaded = await loadBriefData({ actor: user, taskId: (await params).id });
  if (!loaded) return json({ error: "Not found" }, 404);
  const pdf = await renderBriefPdf(loaded.data);
  const disp = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disp}; filename="${briefFileName(loaded.task.taskCode)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
