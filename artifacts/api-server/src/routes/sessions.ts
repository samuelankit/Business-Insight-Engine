import { Router } from "express";
import { db } from "@workspace/db";
import { modeSessionsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/active", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const [session] = await db
      .select()
      .from(modeSessionsTable)
      .where(
        and(
          eq(modeSessionsTable.userId, req.userId!),
          eq(modeSessionsTable.businessId, businessId as string),
          eq(modeSessionsTable.status, "active"),
        ),
      );

    if (!session) {
      res.json({ active: false, sessionId: null, mode: null, step: null, totalSteps: null, stepLabel: null });
      return;
    }

    res.json({
      active: true,
      sessionId: session.id,
      mode: session.mode,
      step: session.currentStep,
      totalSteps: session.totalSteps,
      stepLabel: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/exit", async (req, res, next) => {
  try {
    const { businessId } = req.body;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    await db
      .update(modeSessionsTable)
      .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(modeSessionsTable.userId, req.userId!),
          eq(modeSessionsTable.businessId, businessId),
          eq(modeSessionsTable.status, "active"),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const sessions = await db
      .select()
      .from(modeSessionsTable)
      .where(
        and(
          eq(modeSessionsTable.userId, req.userId!),
          eq(modeSessionsTable.businessId, businessId as string),
        ),
      )
      .orderBy(desc(modeSessionsTable.createdAt))
      .limit(20);

    res.json(sessions.map((s) => ({
      id: s.id,
      mode: s.mode,
      businessId: s.businessId,
      completedAt: s.completedAt?.toISOString() ?? null,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

export default router;
