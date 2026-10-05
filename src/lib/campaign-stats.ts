import type { TaskStage } from "@prisma/client";

export const BUCKETS = ["planning", "production", "editing", "approval", "scheduled", "published"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = {
  planning: "Planning", production: "Production", editing: "Editing / design", approval: "Review & approval", scheduled: "Scheduled", published: "Published",
};

const OF: Record<TaskStage, Bucket> = {
  IDEA: "planning", BRIEF: "planning", ASSIGNED: "planning",
  PRODUCTION: "production", PRODUCTION_REVIEW: "production",
  EDITING: "editing", EDITING_REVIEW: "editing",
  INTERNAL_APPROVAL: "approval", SOCIAL_APPROVAL: "approval",
  SCHEDULED: "scheduled", PUBLISHED: "published", COMPLETED: "published",
};
export const bucketOf = (s: TaskStage): Bucket => OF[s];

export interface CampaignSummary { total: number; buckets: Record<Bucket, number>; done: number; percent: number; overdue: number }

export function summarize(stageCounts: Partial<Record<TaskStage, number>>, overdue = 0): CampaignSummary {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  let total = 0;
  for (const [stage, n] of Object.entries(stageCounts) as [TaskStage, number][]) { buckets[bucketOf(stage)] += n; total += n; }
  const done = buckets.published;
  return { total, buckets, done, percent: total ? Math.round((done / total) * 100) : 0, overdue };
}
