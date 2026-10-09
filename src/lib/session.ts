import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { Organization, User } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { can, type Permission } from "./rbac";

const COOKIE = "basma_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const key = () => new TextEncoder().encode(env.sessionSecret);

export async function createSession(userId: string, sessionVersion = 0) {
  const token = await new SignJWT({ uid: userId, sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export type SessionUser = User & { organization: Organization };

/** Current user, re-read from the DB on every request so disabling/role changes apply immediately. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const user = await db.user.findFirst({
      where: { id: String(payload.uid), status: "ACTIVE", deletedAt: null },
      include: { organization: true },
    });
    // A password reset bumps sessionVersion, which invalidates every cookie issued before it.
    return user && user.sessionVersion === Number(payload.sv ?? 0) ? user : null;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirect to the dashboard when the role lacks the permission. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}
