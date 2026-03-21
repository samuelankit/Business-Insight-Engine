import { Router } from "express";
import { db } from "@workspace/db";
import { userSubscriptionsTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { PLANS, getOrCreateSubscription } from "../lib/usage.js";

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

export default router;
