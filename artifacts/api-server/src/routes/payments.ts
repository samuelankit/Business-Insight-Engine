import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../lib/auth.js";
import { getOrCreateWallet } from "../lib/usage.js";

const router = Router();

const MIN_PENCE = 2000;
const MAX_PENCE = 50000;

router.post("/topup/intent", requireAuth, async (req, res, next) => {
  try {
    const stripeKey = process.env["STRIPE_SECRET_KEY"];
    if (!stripeKey) {
      res.status(500).json({ error: "Stripe is not configured" });
      return;
    }

    const { amountPence } = req.body;
    if (typeof amountPence !== "number" || !Number.isInteger(amountPence)) {
      res.status(400).json({ error: "amountPence must be an integer" });
      return;
    }
    if (amountPence < MIN_PENCE || amountPence > MAX_PENCE) {
      res.status(400).json({
        error: `Amount must be between £${MIN_PENCE / 100} and £${MAX_PENCE / 100}`,
        minPence: MIN_PENCE,
        maxPence: MAX_PENCE,
      });
      return;
    }

    const stripe = new Stripe(stripeKey);
    const wallet = await getOrCreateWallet(req.userId!);

    const domain = process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : process.env["REPLIT_DOMAINS"]
        ? `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0]}`
        : "https://localhost";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "gbp",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: amountPence,
            product_data: {
              name: `GoRigo Wallet Top-Up — £${(amountPence / 100).toFixed(2)}`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          userId: req.userId!,
          walletId: wallet.id,
          type: "wallet_topup",
        },
      },
      success_url: `${domain}/?topup=success&amount=${amountPence}`,
      cancel_url: `${domain}/?topup=cancelled`,
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
      amountPence,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
