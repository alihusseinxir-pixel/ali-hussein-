import bcrypt from "bcryptjs";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
// Verify against a real hash when the email is unknown so response time doesn't reveal which emails exist.
let dummy: string | undefined;
export const dummyVerify = async (pw: string) => {
  dummy ??= bcrypt.hashSync("not-a-real-password", 12);
  await bcrypt.compare(pw, dummy);
};
