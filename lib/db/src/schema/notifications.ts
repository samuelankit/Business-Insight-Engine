import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("push_tokens_user_idx").on(t.userId),
    unique("push_tokens_user_token").on(t.userId, t.token),
  ],
);

export type PushToken = typeof pushTokensTable.$inferSelect;

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    agentActivity: boolean("agent_activity").notNull().default(true),
    communications: boolean("communications").notNull().default(true),
    billingAlerts: boolean("billing_alerts").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("notif_prefs_user_business").on(t.userId, t.businessId)],
);

export type NotificationPreference =
  typeof notificationPreferencesTable.$inferSelect;
