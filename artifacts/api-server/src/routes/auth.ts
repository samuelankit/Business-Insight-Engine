import { Router } from "express";
import { z } from "zod/v4";
import { authenticateDevice } from "../lib/auth.js";
import { getOrCreateSubscription, getOrCreateWallet } from "../lib/usage.js";
import { db } from "@workspace/db";
import { usersTable, userTokensTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { generateToken, encrypt, generateOAuthState, generateCodeVerifier } from "../lib/crypto.js";
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
import { createRemoteJWKSet, jwtVerify } from "jose";

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

/**
 * Microsoft OAuth 2.0 / Entra ID admin login.
 *
 * GET /auth/microsoft/redirect — builds the Microsoft authorization URL and returns it.
 * The mobile app opens this URL in an in-app browser (expo-web-browser).
 *
 * POST /auth/microsoft/callback — exchanges the authorization code for tokens,
 * verifies the Microsoft identity, creates or links a GoRigo user, and returns a session.
 *
 * Environment variables required:
 *   ENTRA_TENANT_ID  — Azure AD tenant ID
 *   ENTRA_CLIENT_ID  — App registration client ID
 *   ENTRA_ADMIN_EMAIL — The one Microsoft account email allowed to gain admin access
 *                       (optional; if unset, any verified Microsoft account in the tenant gains admin)
 */

const ENTRA_TENANT_ID = () => process.env["ENTRA_TENANT_ID"];
const ENTRA_CLIENT_ID = () => process.env["ENTRA_CLIENT_ID"];
const ENTRA_ADMIN_EMAIL = () => (process.env["ENTRA_ADMIN_EMAIL"] ?? "").toLowerCase().trim();

const pendingOAuthStates = new Map<string, { codeVerifier: string; redirectUri: string; createdAt: number }>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingOAuthStates) {
    if (v.createdAt < cutoff) pendingOAuthStates.delete(k);
  }
}, 60_000);

router.get("/microsoft/redirect", async (req, res) => {
  const tenantId = ENTRA_TENANT_ID();
  const clientId = ENTRA_CLIENT_ID();

  if (!tenantId || !clientId) {
    res.status(503).json({ error: "Microsoft login not configured" });
    return;
  }

  const redirectUri = (req.query["redirectUri"] as string | undefined) ?? "mobile://auth/microsoft/callback";

  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();

  const { createHash } = await import("crypto");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  pendingOAuthStates.set(state, { codeVerifier, redirectUri, createdAt: Date.now() });

  const scope = encodeURIComponent("openid profile email offline_access");
  const url =
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&prompt=select_account`;

  res.json({ url, state });
});

const MicrosoftCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  deviceId: z.string().min(1).max(200),
  platform: z.enum(["ios", "android", "web"]),
  redirectUri: z.string().url().optional(),
});

router.post("/microsoft/callback", async (req, res, next) => {
  try {
    const parsed = MicrosoftCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const tenantId = ENTRA_TENANT_ID();
    const clientId = ENTRA_CLIENT_ID();

    if (!tenantId || !clientId) {
      res.status(503).json({ error: "Microsoft login not configured" });
      return;
    }

    const { code, state, deviceId, platform } = parsed.data;

    const pending = pendingOAuthStates.get(state);
    if (!pending) {
      res.status(400).json({ error: "Invalid or expired OAuth state" });
      return;
    }
    pendingOAuthStates.delete(state);

    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
      scope: "openid profile email offline_access",
    });

    const tokenResp = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    if (!tokenResp.ok) {
      const errorText = await tokenResp.text();
      console.error("[microsoft/callback] Token exchange failed:", errorText);
      res.status(401).json({ error: "Microsoft token exchange failed" });
      return;
    }

    const tokens = await tokenResp.json() as {
      id_token?: string;
      access_token?: string;
    };

    if (!tokens.id_token) {
      res.status(401).json({ error: "No ID token received from Microsoft" });
      return;
    }

    const jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );

    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    });

    const microsoftEmail = (
      (payload["preferred_username"] as string | undefined) ||
      (payload["email"] as string | undefined) ||
      ""
    ).toLowerCase().trim();

    const microsoftOid = payload["oid"] as string | undefined;
    const microsoftName = payload["name"] as string | undefined;

    if (!microsoftOid || !microsoftEmail) {
      res.status(401).json({ error: "Unable to extract identity from Microsoft token" });
      return;
    }

    const allowedEmail = ENTRA_ADMIN_EMAIL();
    if (!allowedEmail) {
      res.status(503).json({
        error: "Admin login not configured",
        message: "ENTRA_ADMIN_EMAIL environment variable must be set to the owner's Microsoft account email.",
      });
      return;
    }
    if (microsoftEmail !== allowedEmail) {
      res.status(403).json({ error: "This Microsoft account is not authorised for admin access" });
      return;
    }

    const tenantIdFromToken = payload["tid"] as string | undefined;

    let [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.microsoftOid, microsoftOid))
      .limit(1);

    if (!existingUser) {
      [existingUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.deviceId, deviceId))
        .limit(1);
    }

    if (!existingUser) {
      const id = generateToken(16);
      await db.insert(usersTable).values({
        id,
        deviceId,
        platform,
        email: microsoftEmail,
        emailVerified: true,
        microsoftOid,
        microsoftTenantId: tenantIdFromToken ?? null,
        isAdminUser: true,
      });
      [existingUser] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      await getOrCreateSubscription(existingUser!.id);
      await getOrCreateWallet(existingUser!.id);
    } else {
      await db
        .update(usersTable)
        .set({
          email: existingUser.email ?? microsoftEmail,
          emailVerified: true,
          microsoftOid,
          microsoftTenantId: tenantIdFromToken ?? existingUser.microsoftTenantId,
          isAdminUser: true,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingUser.id));
    }

    const userId = existingUser!.id;
    const sessionToken = generateToken(32);
    const { encryptedDek } = encrypt(sessionToken);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await db.insert(userTokensTable).values({
      id: generateToken(16),
      userId,
      token: sessionToken,
      encryptedDek,
      expiresAt,
    });

    res.json({
      success: true,
      userId,
      token: sessionToken,
      isAdmin: true,
      microsoftEmail,
      microsoftName: microsoftName ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
