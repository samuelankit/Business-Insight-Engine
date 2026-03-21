import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const modeSessionsTable = pgTable(
  "mode_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    currentStep: integer("current_step").notNull().default(0),
    totalSteps: integer("total_steps").notNull(),
    status: text("status").notNull().default("active"),
    context: text("context"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("mode_sessions_user_idx").on(t.userId, t.status),
    index("mode_sessions_business_idx").on(t.businessId),
  ],
);

export type ModeSession = typeof modeSessionsTable.$inferSelect;

export const conversationsTable = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversations_user_business_idx").on(t.userId, t.businessId),
    index("conversations_created_at_idx").on(t.createdAt),
  ],
);
