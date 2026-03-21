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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("users_device_id_idx").on(t.deviceId)],
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
    // DEK encrypted by the platform KEK — envelope encryption
    encryptedDek: text("encrypted_dek").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("user_tokens_user_idx").on(t.userId)],
);

export type UserToken = typeof userTokensTable.$inferSelect;

export const voicePreferencesTable = pgTable("voice_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("google"),
  voiceName: text("voice_name"),
  speechRate: text("speech_rate"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type VoicePreference = typeof voicePreferencesTable.$inferSelect;
