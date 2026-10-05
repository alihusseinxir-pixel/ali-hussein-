import type { Role } from "@prisma/client";

/**
 * Permission matrix. Single source of truth — UI and server both call `can()`.
 * Every server action must still scope queries by organizationId; RBAC answers
 * "may this role do X", tenancy answers "on whose data".
 */
export const PERMISSIONS = [
  "user:manage", // invite / disable / change role
  "org:settings",
  "task:create",
  "task:view:all", // otherwise only tasks the user created or has owned
  "task:edit:any",
  "task:edit:own", // tasks the user created
  "task:assign",
  "task:delete",
  "task:comment",
  "campaign:manage",
  "template:manage",
  "activity:view:all",
  "analytics:view:all", // org-wide analytics; everyone else sees only their own numbers
  "approval:internal",
  "approval:final",
  "publish:manage",
  "calendar:view:all",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PRODUCTION: Permission[] = ["task:comment"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MARKETING_MANAGER: [
    "task:create", "task:view:all", "task:edit:any", "task:assign", "task:delete", "task:comment",
    "campaign:manage", "template:manage", "activity:view:all", "analytics:view:all", "approval:internal", "calendar:view:all",
  ],
  SOCIAL_MEDIA_MANAGER: [
    "task:create", "task:view:all", "task:edit:own", "task:assign", "task:comment",
    "campaign:manage", "template:manage", "analytics:view:all", "approval:internal", "approval:final", "publish:manage", "calendar:view:all",
  ],
  VIDEOGRAPHER: PRODUCTION,
  PHOTOGRAPHER: PRODUCTION,
  VIDEO_EDITOR: PRODUCTION,
  DESIGNER: PRODUCTION,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MARKETING_MANAGER: "Marketing Manager",
  SOCIAL_MEDIA_MANAGER: "Social Media Manager",
  VIDEOGRAPHER: "Videographer",
  PHOTOGRAPHER: "Photographer",
  VIDEO_EDITOR: "Video Editor",
  DESIGNER: "Designer",
};

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError();
}
