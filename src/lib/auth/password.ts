import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Include at least one letter and one number.");

let dummyHash: Promise<string> | null = null;
/** Compared against when the username does not exist, so response time doesn't reveal valid usernames. */
export function getDummyHash() {
  dummyHash ??= bcrypt.hash("not-a-real-password", COST);
  return dummyHash;
}
