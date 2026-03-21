import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, userSubscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { getOrCreateSubscription, PLANS } from "../lib/usage.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.delete("/", requireAuth, async (req, res, next) => {
  try {
    await db.delete(usersTable).where(eq(usersTable.id, req.userId!));
    res.json({ success: true, message: "Your account and all associated data have been permanently deleted." });
  } catch (err) {
    next(err);
  }
});

router.post("/activate-plan", requireAuth, async (req, res, next) => {
  try {
    const { planId } = req.body;

    if (!planId) {
      res.status(400).json({ error: "planId is required" });
      return;
    }

    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) {
      res.status(400).json({ error: "Invalid planId" });
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const existing = await getOrCreateSubscription(req.userId!);

    await db
      .update(userSubscriptionsTable)
      .set({
        planId: plan.id,
        status: "active",
        periodStart: existing.periodStart,
        periodEnd,
        updatedAt: now,
      })
      .where(eq(userSubscriptionsTable.userId, req.userId!));

    logger.info({ userId: req.userId, planId: plan.id }, "Plan activated via activate-plan endpoint");

    res.json({ success: true, planId: plan.id, planName: plan.name });
  } catch (err) {
    next(err);
  }
});

export default router;
