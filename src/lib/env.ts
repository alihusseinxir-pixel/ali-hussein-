function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get timezone() {
    return process.env.APP_TIMEZONE ?? "Asia/Riyadh";
  },
  /** First day of the week in the calendar: 0 = Sunday (default), 1 = Monday, 6 = Saturday. */
  get weekStart() {
    const n = Number(process.env.WEEK_START ?? 0);
    return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
  },
  get allowSignup() {
    return process.env.ALLOW_SIGNUP !== "false";
  },
};
