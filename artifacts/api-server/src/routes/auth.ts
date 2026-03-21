import { Router } from "express";
import { z } from "zod/v4";
import { authenticateDevice } from "../lib/auth.js";
import { getOrCreateSubscription, getOrCreateWallet } from "../lib/usage.js";
import { db } from "@workspace/db";
import { businessesTable, teamMembersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateToken } from "../lib/crypto.js";

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
      // Bootstrap new user
      await getOrCreateSubscription(result.userId);
      await getOrCreateWallet(result.userId);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
