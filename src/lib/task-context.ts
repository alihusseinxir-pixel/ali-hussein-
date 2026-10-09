import type { Task } from "@prisma/client";

/** Snapshot of everything the receiver needs, frozen at handover time (history is never lost). */
export function contextSnapshot(t: Task) {
  return {
    brief: t.brief, script: t.script, models: t.models, location: t.location, props: t.props, product: t.product,
    references: t.references, caption: t.caption, hashtags: t.hashtags, platform: t.platform,
    shootingAt: t.shootingAt?.toISOString() ?? null, publishAt: t.publishAt?.toISOString() ?? null,
  };
}
