import "server-only";
import { db } from "./db";
import { env } from "./env";
import { formatDateTime } from "./datetime";
import { ROLE_LABELS } from "./rbac";
import { visibleTasksWhere, type Actor } from "./tasks";
import type { BriefData } from "./brief-pdf";

const stageName = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Load everything the PDF needs. `actor` = null is used by validated share links (task scoped by id only). */
export async function loadBriefData(where: { actor: Actor; taskId: string } | { organizationId: string; taskId: string }) {
  const scope = "actor" in where ? visibleTasksWhere(where.actor) : { organizationId: where.organizationId, deletedAt: null };
  const t = await db.task.findFirst({
    where: { AND: [scope, { id: where.taskId }] },
    include: {
      organization: { select: { name: true } }, brand: { select: { name: true } }, campaign: { select: { name: true } },
      createdBy: { select: { name: true, role: true } }, currentAssignee: { select: { name: true, role: true } },
      assignments: { include: { user: { select: { name: true, role: true } } }, orderBy: { assignedAt: "asc" } },
    },
  });
  if (!t) return null;
  const tz = env.timezone;
  const team: BriefData["team"] = [{ role: `Created by (${ROLE_LABELS[t.createdBy.role]})`, name: t.createdBy.name }];
  if (t.currentAssignee) team.push({ role: `Current owner (${ROLE_LABELS[t.currentAssignee.role]})`, name: t.currentAssignee.name });
  const seen = new Set([t.createdBy.name, t.currentAssignee?.name]);
  for (const a of t.assignments) {
    if (!seen.has(a.user.name)) { seen.add(a.user.name); team.push({ role: ROLE_LABELS[a.user.role], name: a.user.name }); }
  }
  const data: BriefData = {
    taskCode: t.taskCode, title: t.title, brand: t.brand?.name ?? null, campaign: t.campaign?.name ?? null,
    contentType: t.contentType, platform: t.platform, priority: t.priority, stage: stageName(t.stage),
    objective: t.objective, targetAudience: t.targetAudience, brief: t.brief, consumerInsight: t.consumerInsight, keyMessage: t.keyMessage,
    cta: t.cta, caption: t.caption, hashtags: t.hashtags, script: t.script, models: t.models, location: t.location, props: t.props,
    product: t.product, shooting: formatDateTime(t.shootingAt, tz), publishing: formatDateTime(t.publishAt, tz), deadline: formatDateTime(t.deadline, tz),
    references: t.references, specialNotes: t.specialNotes, team, generatedAt: formatDateTime(new Date(), tz), orgName: t.organization.name,
  };
  return { data, task: t };
}
