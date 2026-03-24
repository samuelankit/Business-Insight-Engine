import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const agentsTable = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("custom"),
    name: text("name").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt").notNull(),
    jobDescription: text("job_description"),
    isBuiltIn: boolean("is_built_in").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    toolAccess: jsonb("tool_access").$type<string[]>().notNull().default([]),
    scheduleType: text("schedule_type").notNull().default("none"),
    scheduleTime: text("schedule_time"),
    scheduleDay: integer("schedule_day"),
    scheduleInterval: integer("schedule_interval"),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    lastScheduledRunAt: timestamp("last_scheduled_run_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("agents_user_id_idx").on(t.userId),
    index("agents_business_id_idx").on(t.businessId),
    index("agents_next_run_idx").on(t.nextRunAt, t.isActive),
  ],
);

export type Agent = typeof agentsTable.$inferSelect;

export const agentLogsTable = pgTable(
  "agent_logs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    businessId: text("business_id").notNull(),
    summary: text("summary").notNull(),
    actions: jsonb("actions").$type<string[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("agent_logs_agent_id_idx").on(t.agentId),
    index("agent_logs_user_id_idx").on(t.userId),
    index("agent_logs_business_id_idx").on(t.businessId),
    index("agent_logs_created_at_idx").on(t.createdAt),
  ],
);

export type AgentLog = typeof agentLogsTable.$inferSelect;

export const agentPendingActionsTable = pgTable(
  "agent_pending_actions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    businessId: text("business_id").notNull(),
    actionType: text("action_type").notNull(),
    actionDescription: text("action_description").notNull(),
    actionPayload: jsonb("action_payload"),
    toolName: text("tool_name").notNull(),
    functionName: text("function_name").notNull(),
    status: text("status").notNull().default("pending"),
    resultPayload: jsonb("result_payload"),
    expiresAt: timestamp("expires_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("pending_actions_user_idx").on(t.userId, t.status),
    index("pending_actions_business_idx").on(t.businessId, t.status),
  ],
);

export type AgentPendingAction = typeof agentPendingActionsTable.$inferSelect;
