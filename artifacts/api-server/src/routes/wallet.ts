import { Router } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateWallet } from "../lib/usage.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/config", (_req, res) => {
  const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"] ?? null;
  res.json({ stripePublishableKey: publishableKey });
});

const PACKAGES = [
  { id: "starter", name: "Starter", amountPence: 500, credits: 500, bonusLabel: null },
  { id: "standard", name: "Standard", amountPence: 1000, credits: 1100, bonusLabel: "10% bonus" },
  { id: "growth", name: "Growth", amountPence: 2500, credits: 3000, bonusLabel: "20% bonus" },
  { id: "pro", name: "Pro", amountPence: 5000, credits: 7000, bonusLabel: "40% bonus" },
] as const;

router.post("/topup/intent", async (req, res, next) => {
  try {
    const { userId, packageId } = req.body;

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    if (!packageId || typeof packageId !== "string") {
      res.status(400).json({ error: "packageId is required" });
      return;
    }

    const pkg = PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      res.status(400).json({ error: `Invalid packageId. Must be one of: ${PACKAGES.map((p) => p.id).join(", ")}` });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const stripeKey = process.env["STRIPE_SECRET_KEY"];
    if (!stripeKey) {
      res.status(500).json({ error: "Stripe is not configured" });
      return;
    }

    const stripe = new Stripe(stripeKey);

    const intent = await stripe.paymentIntents.create({
      amount: pkg.amountPence,
      currency: "gbp",
      metadata: {
        type: "wallet_topup",
        userId,
        packageId: pkg.id,
      },
      automatic_payment_methods: { enabled: true },
    });

    logger.info({ userId, packageId: pkg.id, amountPence: pkg.amountPence }, "Wallet topup intent created");

    res.json({
      clientSecret: intent.client_secret,
      amountPence: pkg.amountPence,
      credits: pkg.credits,
      packageName: pkg.name,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/balance", async (req, res, next) => {
  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId query param is required" });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const wallet = await getOrCreateWallet(userId);

    res.json({
      balancePence: wallet.balancePence,
      balanceFormatted: `£${(wallet.balancePence / 100).toFixed(2)}`,
      lowBalance: wallet.balancePence < 200,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
