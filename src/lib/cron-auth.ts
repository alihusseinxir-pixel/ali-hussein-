import { createHash, timingSafeEqual } from "node:crypto";

/** `Authorization: Bearer <CRON_SECRET>`; disabled (always false) when no secret is configured. */
export function verifyCronAuth(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith("Bearer ")) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(header.slice(7)), h(secret));
}
