import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const toolConnectionsTable = pgTable(
  "tool_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    credentialType: text("credential_type").notNull(),
    // Envelope encrypted credentials: {iv, ciphertext, authTag, encryptedDek}
    encryptedCredentials: text("encrypted_credentials").notNull(),
    encryptedDek: text("encrypted_dek").notNull(),
    status: text("status").notNull().default("active"),
    scopes: jsonb("scopes").$type<string[]>(),
    metadata: jsonb("metadata"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tool_connections_user_idx").on(t.userId),
    index("tool_connections_user_tool_idx").on(t.userId, t.toolName),
  ],
);

export type ToolConnection = typeof toolConnectionsTable.$inferSelect;

// OAuth state storage with CSRF protection
export const oauthStatesTable = pgTable("oauth_states", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  state: text("state").notNull().unique(),
  codeVerifier: text("code_verifier"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type OAuthState = typeof oauthStatesTable.$inferSelect;
