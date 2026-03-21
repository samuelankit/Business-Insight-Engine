import { Router } from "express";
import { db } from "@workspace/db";
import { pushTokensTable, notificationPreferencesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

router.post("/push-token", async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token || !platform) {
      res.status(400).json({ error: "token and platform required" });
      return;
    }

    await db
      .insert(pushTokensTable)
      .values({ id: generateToken(16), userId: req.userId!, token, platform })
      .onConflictDoNothing();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/push-token", async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    await db
      .delete(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, req.userId!), eq(pushTokensTable.token, token)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/preferences", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const [pref] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.userId, req.userId!),
          eq(notificationPreferencesTable.businessId, businessId as string),
        ),
      );

    if (!pref) {
      res.json({ businessId, agentActivity: true, communications: true, billingAlerts: true });
      return;
    }

    res.json({ businessId, agentActivity: pref.agentActivity, communications: pref.communications, billingAlerts: pref.billingAlerts });
  } catch (err) {
    next(err);
  }
});

router.put("/preferences", async (req, res, next) => {
  try {
    const { businessId, agentActivity, communications, billingAlerts } = req.body;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.userId, req.userId!),
          eq(notificationPreferencesTable.businessId, businessId),
        ),
      );

    if (existing) {
      await db
        .update(notificationPreferencesTable)
        .set({ agentActivity: agentActivity ?? existing.agentActivity, communications: communications ?? existing.communications, billingAlerts: billingAlerts ?? existing.billingAlerts, updatedAt: new Date() })
        .where(eq(notificationPreferencesTable.id, existing.id));
    } else {
      await db.insert(notificationPreferencesTable).values({
        id: generateToken(16),
        userId: req.userId!,
        businessId,
        agentActivity: agentActivity ?? true,
        communications: communications ?? true,
        billingAlerts: billingAlerts ?? true,
      });
    }

    res.json({ businessId, agentActivity: agentActivity ?? true, communications: communications ?? true, billingAlerts: billingAlerts ?? true });
  } catch (err) {
    next(err);
  }
});

export default router;
