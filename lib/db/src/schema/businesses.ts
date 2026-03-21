import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const businessesTable = pgTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sector: text("sector"),
    country: text("country").notNull().default("GB"),
    isActive: boolean("is_active").notNull().default(false),
    disclosureMessage: text("disclosure_message"),
    accountType: text("account_type"),
    intent: text("intent"),
    background: text("background"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("businesses_user_id_idx").on(t.userId),
    index("businesses_user_active_idx").on(t.userId, t.isActive),
  ],
);

export const insertBusinessSchema = createInsertSchema(businessesTable);
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businessesTable.$inferSelect;

export const telnyxConfigsTable = pgTable("telnyx_configs", {
  id: text("id").primaryKey(),
  businessId: text("business_id")
    .notNull()
    .unique()
    .references(() => businessesTable.id, { onDelete: "cascade" }),
  encryptedApiKey: text("encrypted_api_key"),
  phoneNumber: text("phone_number"),
  sipUsername: text("sip_username"),
  disclosureMessage: text("disclosure_message"),
  consentAt: timestamp("consent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TelnyxConfig = typeof telnyxConfigsTable.$inferSelect;
