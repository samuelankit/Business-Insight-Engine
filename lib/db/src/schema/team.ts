import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { businessesTable } from "./businesses";

export const teamMembersTable = pgTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    invitedBy: text("invited_by"),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("team_members_business_idx").on(t.businessId),
    index("team_members_user_idx").on(t.userId),
    unique("team_members_unique").on(t.userId, t.businessId),
  ],
);

export type TeamMember = typeof teamMembersTable.$inferSelect;

export const teamInvitesTable = pgTable(
  "team_invites",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    email: text("email"),
    invitedBy: text("invited_by").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedBy: text("accepted_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("team_invites_business_idx").on(t.businessId)],
);

export type TeamInvite = typeof teamInvitesTable.$inferSelect;

export const teamActivityTable = pgTable(
  "team_activity",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("team_activity_business_idx").on(t.businessId, t.createdAt)],
);

export type TeamActivity = typeof teamActivityTable.$inferSelect;
