import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Stateless, signed description of an upload the server has already authorised (direct-to-bucket flow).
 * The client sends it back to /complete; only a token minted for that very user and task is accepted.
 */
export interface UploadClaim { taskId: string; userId: string; key: string; fileName: string; kind: string; commentId: string | null; size: number; mime: string }

const sign = (body: string) => createHmac("sha256", createHmac("sha256", env.sessionSecret).update("basma:upload:v1").digest()).update(body).digest("base64url");

export function makeUploadToken(c: UploadClaim, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...c, e: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseUploadToken(token: string, now = Date.now()): UploadClaim | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const a = Buffer.from(sign(body)), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!Number.isInteger(p.e) || p.e * 1000 < now) return null;
    for (const k of ["taskId", "userId", "key", "fileName", "kind", "mime"]) if (typeof p[k] !== "string") return null;
    if (!Number.isInteger(p.size) || (p.commentId !== null && typeof p.commentId !== "string")) return null;
    const { e: _e, ...claim } = p; void _e;
    return claim as UploadClaim;
  } catch {
    return null;
  }
}
