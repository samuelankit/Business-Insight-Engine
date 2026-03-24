import { Router, type Request } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { userSubscriptionsTable, usersTable, walletsTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { PLANS, getOrCreateSubscription } from "../lib/usage.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();

const PLAN_ENTITLEMENT_MAP: Record<string, string> = {
  premium: "starter",
};

function entitlementToPlanId(entitlementId: string): string {
  return PLAN_ENTITLEMENT_MAP[entitlementId] ?? "starter";
}

router.post("/revenuecat", async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.event) {
      res.status(400).json({ error: "Invalid event payload" });
      return;
    }

    const { type, app_user_id, entitlement_ids, expiration_at_ms, product_id } = event.event;

    logger.info({ type, app_user_id, product_id }, "RevenueCat webhook received");

    if (!app_user_id) {
      res.status(200).json({ received: true });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, app_user_id))
      .limit(1);

    if (!user) {
      logger.warn({ app_user_id }, "RevenueCat webhook: user not found");
      res.status(200).json({ received: true });
      return;
    }

    const now = new Date();

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE": {
        let planId = "starter";

        if (product_id) {
          if (product_id.includes("pro")) {
            planId = "pro";
          } else if (product_id.includes("starter")) {
            planId = "starter";
          }
        } else if (entitlement_ids && entitlement_ids.length > 0) {
          planId = entitlementToPlanId(entitlement_ids[0]);
        }

        const plan = PLANS.find((p) => p.id === planId) ?? PLANS[1]!;

        const periodEnd = expiration_at_ms
          ? new Date(expiration_at_ms)
          : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

        await getOrCreateSubscription(app_user_id);

        await db
          .update(userSubscriptionsTable)
          .set({
            planId: plan.id,
            status: "active",
            periodStart: now,
            periodEnd,
            updatedAt: now,
          })
          .where(eq(userSubscriptionsTable.userId, app_user_id));

        logger.info({ userId: app_user_id, planId: plan.id, type }, "Subscription activated via webhook");
        break;
      }

      case "CANCELLATION":
      case "EXPIRATION": {
        await db
          .update(userSubscriptionsTable)
          .set({
            planId: "free",
            status: type === "CANCELLATION" ? "cancelled" : "expired",
            updatedAt: now,
          })
          .where(eq(userSubscriptionsTable.userId, app_user_id));

        logger.info({ userId: app_user_id, type }, "Subscription cancelled/expired via webhook");
        break;
      }

      case "UNCANCELLATION": {
        await db
          .update(userSubscriptionsTable)
          .set({
            status: "active",
            updatedAt: now,
          })
          .where(eq(userSubscriptionsTable.userId, app_user_id));

        logger.info({ userId: app_user_id }, "Subscription uncancelled via webhook");
        break;
      }

      default:
        logger.info({ type }, "RevenueCat webhook: unhandled event type");
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "RevenueCat webhook error");
    res.status(200).json({ received: true });
  }
});

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

router.post("/stripe", async (req: RawBodyRequest, res) => {
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.error("Raw body not available for Stripe webhook verification");
    res.status(400).json({ error: "Raw body not available" });
    return;
  }

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    logger.error("STRIPE_SECRET_KEY not configured");
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ message }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { userId, type } = intent.metadata ?? {};

      if (type === "wallet_topup" && userId) {
        const stripeIntentId = intent.id;
        const amountPence = intent.amount;

        try {
          await db.transaction(async (tx) => {
            const [existing] = await tx
              .select({ id: walletTransactionsTable.id })
              .from(walletTransactionsTable)
              .where(eq(walletTransactionsTable.description, `stripe:${stripeIntentId}`))
              .limit(1);

            if (existing) {
              logger.warn({ stripeIntentId }, "Duplicate Stripe webhook — already credited");
              return;
            }

            await tx
              .update(walletsTable)
              .set({
                balancePence: sql`${walletsTable.balancePence} + ${amountPence}`,
                updatedAt: new Date(),
              })
              .where(eq(walletsTable.userId, userId));

            await tx.insert(walletTransactionsTable).values({
              id: generateToken(16),
              userId,
              type: "credit",
              amountPence,
              description: `stripe:${stripeIntentId}`,
              metadata: { stripeIntentId, amountFormatted: `£${(amountPence / 100).toFixed(2)}` },
            });
          });

          logger.info({ userId, amountPence, intentId: stripeIntentId }, "Wallet credited via Stripe webhook");
        } catch (txErr: unknown) {
          const pgCode = (txErr as Record<string, unknown>)?.code;
          if (pgCode === "23505") {
            logger.warn({ stripeIntentId }, "Duplicate Stripe webhook (constraint violation)");
          } else {
            throw txErr;
          }
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook processing error");
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
