/**
 * Device-based authentication middleware.
 *
 * Fix: Device tokens are generated server-side and stored hashed in DB.
 * Devices authenticate with Bearer tokens, not device IDs.
 * Admin access uses a separate admin token from environment, not device ID spoofing.
 */

import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  userTokensTable,
  businessesTable,
} from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { generateToken, encrypt } from "./crypto.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      user?: typeof usersTable.$inferSelect;
      activeBusinessId?: string;
      isAdminSession?: boolean;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Auth middleware — requires valid Bearer token */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const [row] = await db
      .select({ userId: userTokensTable.userId })
      .from(userTokensTable)
      .where(
        and(
          eq(userTokensTable.token, token),
          gt(userTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);

    if (!user || user.suspended) {
      res
        .status(403)
        .json({ error: user?.suspended ? "Account suspended" : "User not found" });
      return;
    }

    req.userId = user.id;
    req.user = user;

    // Attach active business ID from header if provided
    const businessId = req.headers["x-business-id"] as string | undefined;
    if (businessId) {
      req.activeBusinessId = businessId;
    } else {
      // Find the user's active business
      const [activeBusiness] = await db
        .select({ id: businessesTable.id })
        .from(businessesTable)
        .where(
          and(
            eq(businessesTable.userId, user.id),
            eq(businessesTable.isActive, true),
          ),
        )
        .limit(1);
      req.activeBusinessId = activeBusiness?.id;
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Admin auth middleware.
 * Accepts either:
 *   1. A static ADMIN_TOKEN from the environment (existing approach), or
 *   2. A valid GoRigo session token belonging to a user flagged as isAdminUser
 *      (set when they authenticate via Microsoft Entra ID).
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(403).json({ error: "Admin access denied" });
    return;
  }

  const adminToken = process.env["ADMIN_TOKEN"];

  if (adminToken && token === adminToken) {
    next();
    return;
  }

  try {
    const [row] = await db
      .select({ userId: userTokensTable.userId })
      .from(userTokensTable)
      .where(
        and(
          eq(userTokensTable.token, token),
          gt(userTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(403).json({ error: "Admin access denied" });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id, suspended: usersTable.suspended, isAdminUser: usersTable.isAdminUser })
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);

    if (!user || user.suspended || !user.isAdminUser) {
      res.status(403).json({ error: "Admin access denied" });
      return;
    }

    req.userId = user.id;
    req.isAdminSession = true;
    next();
  } catch (err) {
    next(err);
  }
}

/** Register or authenticate a device — creates a user + session token */
export async function authenticateDevice(
  deviceId: string,
  platform: string,
): Promise<{ userId: string; token: string; isNew: boolean }> {
  // Find existing user by device ID
  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.deviceId, deviceId))
    .limit(1);

  let isNew = false;

  if (!user) {
    // Create new user
    const id = generateToken(16);
    const { encryptedPayload, encryptedDek } = encrypt(deviceId);
    await db.insert(usersTable).values({
      id,
      deviceId,
      platform,
    });
    [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    isNew = true;
  }

  // Generate session token
  const token = generateToken(32);
  const { encryptedPayload: _ep, encryptedDek } = encrypt(token);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  await db.insert(userTokensTable).values({
    id: generateToken(16),
    userId: user!.id,
    token,
    encryptedDek,
    expiresAt,
  });

  return { userId: user!.id, token, isNew };
}
