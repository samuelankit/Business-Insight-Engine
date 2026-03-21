import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // Encrypted with user's DEK (envelope encryption)
    encryptedKey: text("encrypted_key").notNull(),
    encryptedDek: text("encrypted_dek").notNull(),
    maskedKey: text("masked_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_user_id_idx").on(t.userId),
    index("api_keys_provider_idx").on(t.userId, t.provider),
  ],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
