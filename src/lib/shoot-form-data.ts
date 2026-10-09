import "server-only";
import { db } from "./db";
import { visibleTasksWhere, type Actor } from "./tasks";
import { listLocations, listTalents } from "./shoot-resources";

/** Everything the shoot form needs to render its pickers. */
export async function shootFormData(a: Actor, keepTaskIds: string[] = []) {
  const org = { organizationId: a.organizationId, status: "ACTIVE" as const, deletedAt: null };
  const pick = { id: true, name: true };
  const [locations, talents, photographers, videographers, directors, tasks] = await Promise.all([
    listLocations(a), listTalents(a),
    db.user.findMany({ where: { ...org, role: "PHOTOGRAPHER" }, orderBy: { name: "asc" }, select: pick }),
    db.user.findMany({ where: { ...org, role: "VIDEOGRAPHER" }, orderBy: { name: "asc" }, select: pick }),
    db.user.findMany({ where: org, orderBy: { name: "asc" }, select: pick }),
    db.task.findMany({ where: { AND: [visibleTasksWhere(a), { OR: [{ stage: { notIn: ["PUBLISHED", "COMPLETED"] } }, { id: { in: keepTaskIds } }] }] }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, taskCode: true, title: true } }),
  ]);
  return { locations, talents, photographers, videographers, directors, tasks };
}
