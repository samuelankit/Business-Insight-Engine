import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().unique(),
    platform: text("platform").notNull().default("ios"),
    suspended: boolean("suspended").notNull().default(false),
    email: text("email").unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    microsoftOid: text("microsoft_oid").unique(),
    microsoftTenantId: text("microsoft_tenant_id"),
    isAdminUser: boolean("is_admin_user").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("users_device_id_idx").on(t.deviceId),
    index("users_email_idx").on(t.email),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const userTokensTable = pgTable(
  "user_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    encryptedDek: text("encrypted_dek").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("user_tokens_user_idx").on(t.userId)],
);

export type UserToken = typeof userTokensTable.$inferSelect;

export const emailOtpsTable = pgTable(
  "email_otps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    hashedCode: text("hashed_code").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_otps_user_idx").on(t.userId),
    index("email_otps_email_idx").on(t.email),
  ],
);

export type EmailOtp = typeof emailOtpsTable.$inferSelect;

export const voicePreferencesTable = pgTable("voice_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("openai"),
  voiceName: text("voice_name"),
  speechRate: text("speech_rate"),
  inputLocale: text("input_locale").notNull().default("en-GB"),
  outputLocale: text("output_locale").notNull().default("en-GB"),
  voicePinHash: text("voice_pin_hash"),
  voiceActivated: boolean("voice_activated").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type VoicePreference = typeof voicePreferencesTable.$inferSelect;

export const voiceCallsTable = pgTable(
  "voice_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    businessId: text("business_id").notNull(),
    agentId: text("agent_id"),
    agentName: text("agent_name"),
    direction: text("direction").notNull().default("outbound"),
    durationSeconds: text("duration_seconds"),
    transcriptSummary: text("transcript_summary"),
    transcript: text("transcript"),
    creditsUsed: text("credits_used").notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("voice_calls_user_idx").on(t.userId, t.createdAt),
    index("voice_calls_business_idx").on(t.businessId),
  ],
);

export type VoiceCall = typeof voiceCallsTable.$inferSelect;

export const voiceSessionsTable = pgTable(
  "voice_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sessionToken: text("session_token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("voice_sessions_user_idx").on(t.userId),
    index("voice_sessions_token_idx").on(t.sessionToken),
  ],
);

export type VoiceSession = typeof voiceSessionsTable.$inferSelect;
