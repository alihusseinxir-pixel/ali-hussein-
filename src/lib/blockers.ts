import type { ScriptStatus } from "@prisma/client";

export interface Blocker { kind: "changes" | "shoot-script" | "shoot-warnings"; message: string; href: string }

/** A script is cleared for shooting once a reviewer has approved it. */
export const SCRIPT_CLEARED: ScriptStatus[] = ["APPROVED", "READY_FOR_PRODUCTION"];

export interface ShootForBlockers {
  id: string; title: string; startsAt: Date; warningCount: number;
  contents: { task: { id: string; title: string; scriptStatus: ScriptStatus } }[];
}

/** Why an upcoming shoot cannot go ahead as planned. Pure: callers decide which shoots are "upcoming". */
export function shootBlockers(s: ShootForBlockers, now: Date): Blocker[] {
  const out: Blocker[] = [];
  // calendar days (UTC), not 24-hour blocks: a shoot at 09:00 tomorrow is "tomorrow" even when it is 25 hours away
  const day = (d: Date) => Math.floor(d.getTime() / 86400_000);
  const days = Math.max(0, day(s.startsAt) - day(now));
  const when = days === 0 ? "اليوم" : days === 1 ? "غداً" : days === 2 ? "بعد يومين" : days <= 10 ? `بعد ${days} أيام` : `بعد ${days} يوماً`;
  for (const { task } of s.contents) {
    if (!SCRIPT_CLEARED.includes(task.scriptStatus)) out.push({ kind: "shoot-script", message: `جلسة "${s.title}" (${when}): سكريبت "${task.title}" غير معتمد.`, href: `/tasks/${task.id}/script` });
  }
  if (s.warningCount > 0) out.push({ kind: "shoot-warnings", message: `جلسة "${s.title}" (${when}) فيها ${s.warningCount} تنبيه.`, href: `/shoots/${s.id}` });
  return out;
}
