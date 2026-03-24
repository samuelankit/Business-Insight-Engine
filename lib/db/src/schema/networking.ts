import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const networkProfilesTable = pgTable(
  "network_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .unique()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    gdprConsentAt: timestamp("gdpr_consent_at"),
    isOptedIn: boolean("is_opted_in").notNull().default(false),
    isPaidAccess: boolean("is_paid_access").notNull().default(false),
    opportunityTypes: jsonb("opportunity_types").$type<string[]>().notNull().default([]),
    sectorPreferences: jsonb("sector_preferences").$type<string[]>().notNull().default([]),
    dealBreakers: text("deal_breakers"),
    mustHaves: text("must_haves"),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("network_profiles_user_id_idx").on(t.userId),
    index("network_profiles_business_id_idx").on(t.businessId),
  ],
);

export type NetworkProfile = typeof networkProfilesTable.$inferSelect;

export const networkMatchesTable = pgTable(
  "network_matches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    matchedBusinessId: text("matched_business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    matchedUserId: text("matched_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    similarityScore: integer("similarity_score").notNull().default(0),
    matchReason: text("match_reason"),
    opportunityType: text("opportunity_type").notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("network_matches_user_idx").on(t.userId, t.businessId),
    index("network_matches_matched_idx").on(t.matchedBusinessId),
  ],
);

export type NetworkMatch = typeof networkMatchesTable.$inferSelect;

export const networkConnectionsTable = pgTable(
  "network_connections",
  {
    id: text("id").primaryKey(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requesterBusinessId: text("requester_business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    receiverUserId: text("receiver_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    receiverBusinessId: text("receiver_business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending_qualification"),
    opportunityType: text("opportunity_type").notNull(),
    handoffMode: text("handoff_mode"),
    matchId: text("match_id"),
    agentRecommendation: text("agent_recommendation"),
    qualificationSummary: text("qualification_summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("network_connections_requester_idx").on(t.requesterUserId),
    index("network_connections_receiver_idx").on(t.receiverUserId),
    index("network_connections_status_idx").on(t.status),
  ],
);

export type NetworkConnection = typeof networkConnectionsTable.$inferSelect;

export const networkQualificationLogsTable = pgTable(
  "network_qualification_logs",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => networkConnectionsTable.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull().default(1),
    agentQuestion: text("agent_question").notNull(),
    userResponse: text("user_response"),
    tokensCost: integer("tokens_cost").notNull().default(0),
    isComplete: boolean("is_complete").notNull().default(false),
    agentRecommendation: text("agent_recommendation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("network_qual_logs_connection_idx").on(t.connectionId),
  ],
);

export type NetworkQualificationLog = typeof networkQualificationLogsTable.$inferSelect;

export const networkFollowupsTable = pgTable(
  "network_followups",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => networkConnectionsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    promptText: text("prompt_text").notNull(),
    scheduledAt: timestamp("scheduled_at").notNull(),
    completedAt: timestamp("completed_at"),
    isDraft: boolean("is_draft").notNull().default(false),
    draftContent: text("draft_content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("network_followups_connection_idx").on(t.connectionId),
    index("network_followups_user_idx").on(t.userId),
    index("network_followups_scheduled_idx").on(t.scheduledAt),
  ],
);

export type NetworkFollowup = typeof networkFollowupsTable.$inferSelect;
