import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";
import { contactListsTable } from "./contacts";

export const campaignsTable = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("sms"),
    listId: text("list_id").references(() => contactListsTable.id),
    subject: text("subject"),
    messageTemplate: text("message_template"),
    status: text("status").notNull().default("draft"),
    scheduledStart: timestamp("scheduled_start"),
    callingHoursStart: text("calling_hours_start"),
    callingHoursEnd: text("calling_hours_end"),
    timezone: text("timezone").notNull().default("Europe/London"),
    budgetCapPence: integer("budget_cap_pence"),
    budgetSpentPence: integer("budget_spent_pence").notNull().default(0),
    pacingPerMinute: integer("pacing_per_minute"),
    sentCount: integer("sent_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    repliedCount: integer("replied_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("campaigns_business_idx").on(t.businessId),
    index("campaigns_status_idx").on(t.status),
  ],
);

export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignMessagesTable = pgTable(
  "campaign_messages",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contactsTable.id),
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    cost: integer("cost"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("campaign_messages_campaign_idx").on(t.campaignId)],
);
