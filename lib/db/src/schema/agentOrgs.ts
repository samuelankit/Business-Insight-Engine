import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  real,
  date,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";
import { agentsTable } from "./agents";

export const agentOrgChartsTable = pgTable(
  "agent_org_charts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goalText: text("goal_text").notNull(),
    verticalSlug: text("vertical_slug").notNull().default("general"),
    status: text("status").notNull().default("draft"),
    nodeCount: integer("node_count").notNull().default(0),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("org_charts_user_idx").on(t.userId),
    index("org_charts_business_idx").on(t.businessId),
    index("org_charts_status_idx").on(t.status),
  ],
);

export type AgentOrgChart = typeof agentOrgChartsTable.$inferSelect;

export const agentOrgNodesTable = pgTable(
  "agent_org_nodes",
  {
    id: text("id").primaryKey(),
    orgChartId: text("org_chart_id")
      .notNull()
      .references(() => agentOrgChartsTable.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    archetypeSlug: text("archetype_slug").notNull(),
    parentNodeId: text("parent_node_id"),
    depth: integer("depth").notNull().default(0),
    displayOrder: integer("display_order").notNull().default(0),
    humanName: text("human_name").notNull(),
    roleSummary: text("role_summary").notNull(),
    department: text("department").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("org_nodes_chart_idx").on(t.orgChartId),
    index("org_nodes_agent_idx").on(t.agentId),
    index("org_nodes_parent_idx").on(t.parentNodeId),
  ],
);

export type AgentOrgNode = typeof agentOrgNodesTable.$inferSelect;

export const agentPerformanceSnapshotsTable = pgTable(
  "agent_performance_snapshots",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    metricKey: text("metric_key").notNull(),
    metricValue: real("metric_value").notNull().default(0),
    metricLabel: text("metric_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("perf_snapshots_agent_idx").on(t.agentId, t.snapshotDate),
    index("perf_snapshots_date_idx").on(t.snapshotDate),
    index("perf_snapshots_metric_idx").on(t.agentId, t.metricKey),
  ],
);

export type AgentPerformanceSnapshot = typeof agentPerformanceSnapshotsTable.$inferSelect;
