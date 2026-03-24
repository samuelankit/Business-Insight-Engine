import { Router } from "express";
import { db } from "@workspace/db";
import {
  userSubscriptionsTable,
  usageEventsTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  PLANS,
  getOrCreateWallet,
  creditWallet,
} from "../lib/usage.js";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.userId!);

    res.json({
      balancePence: wallet.balancePence,
      balanceFormatted: `£${(wallet.balancePence / 100).toFixed(2)}`,
      lowBalance: wallet.balancePence < 200,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const transactions = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, req.userId!))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(50);

    res.json(transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amountPence: t.amountPence,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/plans", (_req, res) => {
  res.json(PLANS);
});

router.get("/subscription", async (req, res, next) => {
  try {
    const [sub] = await db
      .select({
        planId: userSubscriptionsTable.planId,
        status: userSubscriptionsTable.status,
        periodEnd: userSubscriptionsTable.periodEnd,
      })
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, req.userId!))
      .limit(1);

    res.json({
      planId: sub?.planId ?? "free",
      status: sub?.status ?? "active",
      periodEnd: sub?.periodEnd?.toISOString() ?? null,
    });
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
      lowBalance: wallet.balancePence < 200,
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
    res.json({ checkoutUrl: null, message: "Use /api/payments/topup/intent to create a payment intent" });
  } catch (err) {
    next(err);
  }
});

export default router;
