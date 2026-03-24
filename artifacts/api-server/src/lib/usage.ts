import { db } from "@workspace/db";
import {
  usageEventsTable,
  userSubscriptionsTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db/schema";
import { eq, sql, count } from "drizzle-orm";
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

export const EVENT_COSTS_PENCE: Record<string, number> = {
  orchestrate: 5,
  transcribe: 3,
  agent_run: 8,
  realtime_call: 15,
  strategy_generate: 5,
  network_match: 5,
  network_qualification_start: 5,
  network_qualification_complete: 5,
  network_connection_accept: 5,
};

export const DEFAULT_COST_PENCE = 5;

export function getEventCost(eventType: string): number {
  return EVENT_COSTS_PENCE[eventType] ?? DEFAULT_COST_PENCE;
}

const METERED_EVENTS = [
  "orchestrate",
  "transcribe",
  "agent_run",
  "realtime_call",
  "strategy_generate",
  "network_match",
  "network_qualification_start",
  "network_qualification_complete",
  "network_connection_accept",
  "network_intro_sent",
  "network_intro_draft",
  "network_followup_trigger",
  "org_generate",
  "org_assessment",
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
  const wallet = await getOrCreateWallet(userId);
  const costPence = DEFAULT_COST_PENCE;
  const allowed = wallet.balancePence >= costPence;

  const [result] = await db
    .select({ cnt: count() })
    .from(usageEventsTable)
    .where(eq(usageEventsTable.userId, userId));

  const eventsUsed = Number(result?.cnt ?? 0);

  return { allowed, eventsUsed, eventsLimit: -1 };
}

export async function checkWalletAndDebit(
  userId: string,
  eventType: string,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<{ allowed: boolean; balancePence: number; costPence: number }> {
  const costPence = getEventCost(eventType);

  const updated = await db
    .update(walletsTable)
    .set({
      balancePence: sql`${walletsTable.balancePence} - ${costPence}`,
      updatedAt: new Date(),
    })
    .where(
      sql`${walletsTable.userId} = ${userId} AND ${walletsTable.balancePence} >= ${costPence}`,
    )
    .returning({ balancePence: walletsTable.balancePence });

  if (!updated || updated.length === 0) {
    const wallet = await getOrCreateWallet(userId);
    return { allowed: false, balancePence: wallet.balancePence, costPence };
  }

  await db.insert(walletTransactionsTable).values({
    id: generateToken(16),
    userId,
    type: "debit",
    amountPence: costPence,
    description,
    metadata,
  });

  const newBalance = updated[0]!.balancePence;

  if (newBalance < 100) {
    logger.warn({ userId, balance: newBalance }, "Wallet critically low (< £1)");
  } else if (newBalance < 200) {
    logger.warn({ userId, balance: newBalance }, "Wallet low (< £2)");
  }

  return { allowed: true, balancePence: newBalance, costPence };
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

  const wallet = await getOrCreateWallet(userId);
  if (wallet.balancePence < 100) {
    logger.warn({ userId, balance: wallet.balancePence }, "Wallet critically low (< £1)");
  } else if (wallet.balancePence < 200) {
    logger.warn({ userId, balance: wallet.balancePence }, "Wallet low (< £2)");
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
