import { Router } from "express";
import { z } from "zod/v4";
import { authenticateDevice } from "../lib/auth.js";
import { getOrCreateSubscription, getOrCreateWallet } from "../lib/usage.js";
import { db } from "@workspace/db";
import { usersTable, userTokensTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { generateToken, encrypt } from "../lib/crypto.js";
import { requireAuth } from "../lib/auth.js";
import {
  createAndSendOtp,
  verifyOtp,
  findUserByEmail,
  linkEmailToUser,
  checkOtpRateLimit,
  recordOtpRequest,
  checkVerifyRateLimit,
  recordVerifyAttempt,
} from "../lib/email.js";

const router = Router();

const DeviceAuthSchema = z.object({
  deviceId: z.string().min(1).max(200),
  platform: z.enum(["ios", "android", "web"]),
});

router.post("/device", async (req, res, next) => {
  try {
    const parsed = DeviceAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { deviceId, platform } = parsed.data;
    const result = await authenticateDevice(deviceId, platform);

    if (result.isNew) {
      await getOrCreateSubscription(result.userId);
      await getOrCreateWallet(result.userId);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const RequestOtpSchema = z.object({
  email: z.string().email().max(255),
});

router.post("/email/request-otp", requireAuth, async (req, res, next) => {
  try {
    const parsed = RequestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const { email } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const rateCheck = checkOtpRateLimit(`request:${req.userId}:${normalizedEmail}`);
    if (!rateCheck.allowed) {
      res.status(429).json({ error: "Please wait before requesting another code" });
      return;
    }

    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser && existingUser.id !== req.userId) {
      res.status(409).json({ error: "This email is already linked to another account" });
      return;
    }

    await createAndSendOtp(req.userId!, normalizedEmail);
    recordOtpRequest(`request:${req.userId}:${normalizedEmail}`);
    res.json({ success: true, message: "Verification code sent" });
  } catch (err) {
    next(err);
  }
});

const VerifyOtpSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().length(6),
});

router.post("/email/verify-otp", requireAuth, async (req, res, next) => {
  try {
    const parsed = VerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { email, code } = parsed.data;
    const rateLimitKey = `verify:${req.userId}:${email.toLowerCase().trim()}`;

    if (!checkVerifyRateLimit(rateLimitKey)) {
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }

    const result = await verifyOtp(email, code, req.userId!);

    if (!result.valid) {
      recordVerifyAttempt(rateLimitKey, false);
      res.status(400).json({ error: "Invalid or expired verification code" });
      return;
    }

    recordVerifyAttempt(rateLimitKey, true);
    await linkEmailToUser(req.userId!, email);
    res.json({ success: true, message: "Email verified successfully" });
  } catch (err) {
    next(err);
  }
});

const RecoverRequestOtpSchema = z.object({
  email: z.string().email().max(255),
});

router.post("/email/recover-request", async (req, res, next) => {
  try {
    const parsed = RecoverRequestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const { email } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const rateCheck = checkOtpRateLimit(`recover:${normalizedEmail}`);
    if (!rateCheck.allowed) {
      res.json({ success: true, message: "If an account exists, a code has been sent" });
      return;
    }

    const user = await findUserByEmail(normalizedEmail);

    recordOtpRequest(`recover:${normalizedEmail}`);

    if (!user || user.suspended) {
      res.json({ success: true, message: "If an account exists, a code has been sent" });
      return;
    }

    await createAndSendOtp(user.id, normalizedEmail);
    res.json({ success: true, message: "If an account exists, a code has been sent" });
  } catch (err) {
    next(err);
  }
});

const RecoverVerifyOtpSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().length(6),
  deviceId: z.string().min(1).max(200),
  platform: z.enum(["ios", "android", "web"]),
});

router.post("/email/recover-verify", async (req, res, next) => {
  try {
    const parsed = RecoverVerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { email, code, deviceId, platform } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const rateLimitKey = `recover-verify:${normalizedEmail}`;

    if (!checkVerifyRateLimit(rateLimitKey)) {
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }

    const result = await verifyOtp(normalizedEmail, code);

    if (!result.valid || !result.userId) {
      recordVerifyAttempt(rateLimitKey, false);
      res.status(400).json({ error: "Invalid or expired verification code" });
      return;
    }

    recordVerifyAttempt(rateLimitKey, true);

    const [existingDevice] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.deviceId, deviceId))
      .limit(1);

    if (existingDevice && existingDevice.id !== result.userId) {
      const syntheticDeviceId = `orphaned_${existingDevice.id}_${Date.now()}`;
      await db
        .update(usersTable)
        .set({ deviceId: syntheticDeviceId, updatedAt: new Date() })
        .where(eq(usersTable.id, existingDevice.id));
    }

    await db
      .update(usersTable)
      .set({ deviceId, platform, updatedAt: new Date() })
      .where(eq(usersTable.id, result.userId));

    const [existingToken] = await db
      .select({ token: userTokensTable.token })
      .from(userTokensTable)
      .where(
        and(
          eq(userTokensTable.userId, result.userId),
          gt(userTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    let sessionToken: string;

    if (existingToken) {
      sessionToken = existingToken.token;
    } else {
      sessionToken = generateToken(32);
      const { encryptedDek } = encrypt(sessionToken);
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      await db.insert(userTokensTable).values({
        id: generateToken(16),
        userId: result.userId,
        token: sessionToken,
        encryptedDek,
        expiresAt,
      });
    }

    res.json({
      success: true,
      userId: result.userId,
      token: sessionToken,
      recovered: true,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/email/status", requireAuth, async (req, res, next) => {
  try {
    const [user] = await db
      .select({ email: usersTable.email, emailVerified: usersTable.emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    res.json({
      email: user?.email ?? null,
      emailVerified: user?.emailVerified ?? false,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
