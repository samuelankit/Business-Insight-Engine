import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull(),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_user_idx").on(t.userId, t.createdAt),
    index("usage_events_business_idx").on(t.businessId),
    index("usage_events_type_idx").on(t.eventType),
  ],
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  periodStart: timestamp("period_start").notNull().defaultNow(),
  periodEnd: timestamp("period_end").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;

export const walletsTable = pgTable("wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  balancePence: integer("balance_pence").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Wallet = typeof walletsTable.$inferSelect;

export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    amountPence: integer("amount_pence").notNull(),
    description: text("description").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("wallet_tx_user_idx").on(t.userId, t.createdAt)],
);

export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;

export const referralsTable = pgTable("referrals", {
  id: text("id").primaryKey(),
  referrerUserId: text("referrer_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  referredUserId: text("referred_user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  referralCode: text("referral_code").notNull(),
  status: text("status").notNull().default("pending"),
  rewardType: text("reward_type"),
  rewardApplied: boolean("reward_applied").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userReferralCodesTable = pgTable("user_referral_codes", {
  userId: text("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  referralCode: text("referral_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
