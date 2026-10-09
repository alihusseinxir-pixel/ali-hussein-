/**
 * Logging that cannot leak credentials. Use `logError` instead of `console.error(err)` anywhere a storage/AWS/SMTP
 * error could be involved: raw SDK errors and URLs may carry access key ids, signatures or tokens.
 */

const SENSITIVE_ENV = /(SECRET|PASSWORD|TOKEN|ACCESS_KEY|SMTP_URL|DATABASE_URL|CRON)/i;

/** Scrub anything credential-shaped from text before it is written to a log. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  // the actual configured secrets, verbatim (≥ 8 chars so tiny values do not shred ordinary words)
  for (const [k, v] of Object.entries(env)) {
    if (v && v.length >= 8 && SENSITIVE_ENV.test(k)) out = out.split(v).join(`[redacted:${k}]`);
  }
  return out
    .replace(/\b(AKIA|ASIA|AIDA|AROA)[0-9A-Z]{12,}\b/g, "[redacted:aws-key-id]") // AWS access key ids
    .replace(/(X-Amz-(?:Signature|Credential|Security-Token|Signed-Headers))=[^&\s"']+/gi, "$1=[redacted]") // presigned URL parts
    .replace(/(aws_secret_access_key|secret_access_key|secretaccesskey)(["'\s:=]+)[A-Za-z0-9/+=]{16,}/gi, "$1$2[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, "$1[redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[redacted]@"); // user:password@host
}

/** Name, message, status and code only — never the raw object (SDK errors embed request/response details). */
export function describeError(e: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (e instanceof Error) {
    const meta = (e as { $metadata?: { httpStatusCode?: number } }).$metadata;
    const code = (e as { code?: string }).code;
    return redact(`${e.name}: ${e.message}${meta?.httpStatusCode ? ` (HTTP ${meta.httpStatusCode})` : ""}${code ? ` [${code}]` : ""}`, env);
  }
  return redact(String(e), env);
}

export function logError(tag: string, e: unknown): void {
  console.error(`[${tag}] ${describeError(e)}`);
}
