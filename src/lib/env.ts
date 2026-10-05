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
  get allowSignup() {
    return process.env.ALLOW_SIGNUP !== "false";
  },
};
