import { Router } from "express";
import { db } from "@workspace/db";
import {
  userSubscriptionsTable,
  usageEventsTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  PLANS,
  getOrCreateSubscription,
  getOrCreateWallet,
  checkUsageLimit,
  creditWallet,
} from "../lib/usage.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req, res, next) => {
  try {
    const sub = await getOrCreateSubscription(req.userId!);
    const plan = PLANS.find((p) => p.id === sub.planId) ?? PLANS[0]!;
    const { eventsUsed, eventsLimit } = await checkUsageLimit(req.userId!);

    const events = await db
      .select({ eventType: usageEventsTable.eventType })
      .from(usageEventsTable)
      .where(
        and(
          eq(usageEventsTable.userId, req.userId!),
          gte(usageEventsTable.createdAt, sub.periodStart),
        ),
      );

    const breakdown: Record<string, number> = {};
    for (const e of events) {
      breakdown[e.eventType] = (breakdown[e.eventType] ?? 0) + 1;
    }

    res.json({
      planId: plan.id,
      planName: plan.name,
      eventsUsed,
      eventsLimit,
      eventsRemaining: eventsLimit === -1 ? -1 : Math.max(0, eventsLimit - eventsUsed),
      periodStart: sub.periodStart.toISOString(),
      periodEnd: sub.periodEnd.toISOString(),
      breakdown,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    res.json([]);
  } catch (err) {
    next(err);
  }
});

router.get("/plans", (_req, res) => {
  res.json(PLANS);
});

router.post("/upgrade", async (req, res, next) => {
  try {
    const { planId } = req.body;
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) {
      res.status(400).json({ error: "Invalid plan" });
      return;
    }

    if (plan.id === "free") {
      await db
        .update(userSubscriptionsTable)
        .set({ planId: "free", updatedAt: new Date() })
        .where(eq(userSubscriptionsTable.userId, req.userId!));
      res.json({ success: true, checkoutUrl: null });
      return;
    }

    // For paid plans, would create Stripe checkout session
    res.json({
      success: false,
      checkoutUrl: null,
      message: "Stripe integration required for paid plans",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/billing-portal", async (req, res, next) => {
  try {
    res.json({ url: null });
  } catch (err) {
    next(err);
  }
});

router.get("/wallet", async (req, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.userId!);
    const transactions = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, req.userId!))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(20);

    res.json({
      balancePence: wallet.balancePence,
      balanceFormatted: `£${(wallet.balancePence / 100).toFixed(2)}`,
      recentTransactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amountPence: t.amountPence,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/wallet/topup", async (req, res, next) => {
  try {
    res.json({ checkoutUrl: null, message: "Stripe integration required for wallet top-up" });
  } catch (err) {
    next(err);
  }
});

export default router;
