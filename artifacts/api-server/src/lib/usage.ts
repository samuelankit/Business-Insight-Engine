import { db } from "@workspace/db";
import {
  usageEventsTable,
  userSubscriptionsTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, sql, count, inArray } from "drizzle-orm";
import { generateToken } from "./crypto.js";
import { logger } from "./logger.js";

export const PLANS = [
  {
    id: "free",
    name: "Free",
    eventsPerMonth: 50,
    pricePencePerMonth: 0,
    description: "50 AI events per month",
  },
  {
    id: "pro",
    name: "Pro",
    eventsPerMonth: 500,
    pricePencePerMonth: 1900,
    description: "500 AI events per month",
  },
  {
    id: "unlimited",
    name: "Unlimited",
    eventsPerMonth: -1,
    pricePencePerMonth: 4900,
    description: "Unlimited AI events per month",
  },
];

const METERED_EVENTS = [
  "orchestrate",
  "transcribe",
  "agent_run",
  "realtime_call",
];

export async function recordUsage(
  userId: string,
  businessId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(usageEventsTable).values({
    id: generateToken(16),
    userId,
    businessId,
    eventType,
    metadata,
  });
}

export async function checkUsageLimit(userId: string): Promise<{
  allowed: boolean;
  eventsUsed: number;
  eventsLimit: number;
}> {
  const now = new Date();
  const [sub] = await db
    .select()
    .from(userSubscriptionsTable)
    .where(eq(userSubscriptionsTable.userId, userId))
    .limit(1);

  const plan = PLANS.find((p) => p.id === (sub?.planId ?? "free")) ?? PLANS[0]!;

  if (plan.eventsPerMonth === -1) {
    return { allowed: true, eventsUsed: 0, eventsLimit: -1 };
  }

  const periodStart = sub?.periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = sub?.periodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [result] = await db
    .select({ cnt: count() })
    .from(usageEventsTable)
    .where(
      and(
        eq(usageEventsTable.userId, userId),
        gte(usageEventsTable.createdAt, periodStart),
        lte(usageEventsTable.createdAt, periodEnd),
        inArray(usageEventsTable.eventType, METERED_EVENTS),
      ),
    );

  const eventsUsed = Number(result?.cnt ?? 0);
  const allowed = eventsUsed < plan.eventsPerMonth;

  return { allowed, eventsUsed, eventsLimit: plan.eventsPerMonth };
}

export async function getOrCreateSubscription(
  userId: string,
): Promise<typeof userSubscriptionsTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(userSubscriptionsTable)
    .where(eq(userSubscriptionsTable.userId, userId))
    .limit(1);

  if (existing) return existing;

  const now = new Date();
  const periodEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
  );

  const sub = {
    id: generateToken(16),
    userId,
    planId: "free",
    periodStart: now,
    periodEnd,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(userSubscriptionsTable).values(sub);
  return sub as typeof userSubscriptionsTable.$inferSelect;
}

export async function getOrCreateWallet(userId: string): Promise<typeof walletsTable.$inferSelect> {
  const [wallet] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.userId, userId))
    .limit(1);

  if (wallet) return wallet;

  const newWallet = {
    id: generateToken(16),
    userId,
    balancePence: 0,
    updatedAt: new Date(),
  };
  await db.insert(walletsTable).values(newWallet);
  return newWallet as typeof walletsTable.$inferSelect;
}

export async function checkWalletBalance(
  userId: string,
  requiredPence: number,
): Promise<boolean> {
  const wallet = await getOrCreateWallet(userId);
  return wallet.balancePence >= requiredPence;
}

export async function debitWallet(
  userId: string,
  amountPence: number,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(walletsTable)
    .set({
      balancePence: sql`${walletsTable.balancePence} - ${amountPence}`,
      updatedAt: new Date(),
    })
    .where(eq(walletsTable.userId, userId));

  await db.insert(walletTransactionsTable).values({
    id: generateToken(16),
    userId,
    type: "debit",
    amountPence,
    description,
    metadata,
  });

  // Low balance push notifications
  const wallet = await getOrCreateWallet(userId);
  if (wallet.balancePence < 100) {
    logger.warn({ userId, balance: wallet.balancePence }, "Wallet critically low (< £1)");
  } else if (wallet.balancePence < 500) {
    logger.warn({ userId, balance: wallet.balancePence }, "Wallet low (< £5)");
  }
}

export async function creditWallet(
  userId: string,
  amountPence: number,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(walletsTable)
    .set({
      balancePence: sql`${walletsTable.balancePence} + ${amountPence}`,
      updatedAt: new Date(),
    })
    .where(eq(walletsTable.userId, userId));

  await db.insert(walletTransactionsTable).values({
    id: generateToken(16),
    userId,
    type: "credit",
    amountPence,
    description,
    metadata,
  });
}
