import { createHash, randomInt } from "crypto";
import { db } from "@workspace/db";
import { emailOtpsTable, usersTable } from "@workspace/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { generateToken } from "./crypto.js";
import { logger } from "./logger.js";

const MAX_OTP_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 60_000;

const otpAttempts = new Map<string, { count: number; lastAttempt: number }>();
const otpCooldowns = new Map<string, number>();

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function checkOtpRateLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();

  const cooldown = otpCooldowns.get(key);
  if (cooldown && now < cooldown) {
    return { allowed: false, retryAfterMs: cooldown - now };
  }

  return { allowed: true };
}

export function recordOtpRequest(key: string): void {
  otpCooldowns.set(key, Date.now() + OTP_COOLDOWN_MS);
}

export function checkVerifyRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = otpAttempts.get(key);

  if (entry && now - entry.lastAttempt < 15 * 60_000) {
    if (entry.count >= MAX_OTP_ATTEMPTS) {
      return false;
    }
  }

  return true;
}

export function recordVerifyAttempt(key: string, success: boolean): void {
  const now = Date.now();
  const entry = otpAttempts.get(key);

  if (success) {
    otpAttempts.delete(key);
    return;
  }

  if (entry && now - entry.lastAttempt < 15 * 60_000) {
    entry.count += 1;
    entry.lastAttempt = now;
  } else {
    otpAttempts.set(key, { count: 1, lastAttempt: now });
  }
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    logger.info({ email }, "OTP requested — email delivery not configured");
  } else {
    logger.info({ email, code }, "[DEV ONLY] OTP code for testing");
  }
}

export async function createAndSendOtp(userId: string, email: string): Promise<void> {
  const code = generateOtpCode();
  const hashedCode = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(emailOtpsTable).values({
    id: generateToken(16),
    userId,
    email: email.toLowerCase().trim(),
    hashedCode,
    expiresAt,
  });

  await sendOtpEmail(email, code);
}

export async function verifyOtp(
  email: string,
  code: string,
  expectedUserId?: string,
): Promise<{ valid: boolean; userId: string | null }> {
  const normalizedEmail = email.toLowerCase().trim();
  const hashedCode = hashOtpCode(code);

  const [otp] = await db
    .select()
    .from(emailOtpsTable)
    .where(
      and(
        eq(emailOtpsTable.email, normalizedEmail),
        eq(emailOtpsTable.hashedCode, hashedCode),
        gt(emailOtpsTable.expiresAt, new Date()),
        isNull(emailOtpsTable.usedAt),
      ),
    )
    .limit(1);

  if (!otp) {
    return { valid: false, userId: null };
  }

  if (expectedUserId && otp.userId !== expectedUserId) {
    return { valid: false, userId: null };
  }

  await db
    .update(emailOtpsTable)
    .set({ usedAt: new Date() })
    .where(eq(emailOtpsTable.id, otp.id));

  return { valid: true, userId: otp.userId };
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);
  return user ?? null;
}

export async function linkEmailToUser(userId: string, email: string): Promise<void> {
  await db
    .update(usersTable)
    .set({
      email: email.toLowerCase().trim(),
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}
