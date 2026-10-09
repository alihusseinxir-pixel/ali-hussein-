import type { CalendarEventType } from "@prisma/client";

/** One calendar entry: a task date (links to the task) or a shoot session (links to the session). */
export interface CalEvent {
  id: string; type: CalendarEventType; title: string; startsAt: Date; endsAt: Date | null;
  href: string; ref: string; userName: string | null;
}
