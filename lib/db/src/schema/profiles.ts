import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const userProfilesTable = pgTable(
  "user_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    email: text("email"),
    country: text("country"),
    accountType: text("account_type"),
    intent: text("intent"),
    background: text("background"),
    tocAcceptedAt: timestamp("toc_accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("user_profiles_user_id_idx").on(t.userId),
  ],
);

export type UserProfile = typeof userProfilesTable.$inferSelect;

export const strategiesTable = pgTable(
  "strategies",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    framework: text("framework").notNull(),
    prompt: text("prompt").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("strategies_business_idx").on(t.businessId, t.framework),
    index("strategies_user_idx").on(t.userId),
  ],
);

export type Strategy = typeof strategiesTable.$inferSelect;
