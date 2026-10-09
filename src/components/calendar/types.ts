import type { CalendarEventType } from "@prisma/client";

export interface CalEvent {
  id: string; type: CalendarEventType; title: string; startsAt: Date; endsAt: Date | null;
  task: { id: string; taskCode: string }; userName: string | null;
}
