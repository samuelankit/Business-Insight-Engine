import app from "./app";
import { logger } from "./lib/logger";
import { refreshExpiredTokens } from "./routes/tools.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function applyMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE knowledge_documents
      ADD COLUMN IF NOT EXISTS agent_id TEXT
      REFERENCES agents(id) ON DELETE SET NULL
    `);
    logger.info("DB migrations applied");
  } catch (err) {
    logger.warn({ err }, "Migration step failed (may already be applied)");
  }

  try {
    await db.execute(sql`
      ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb
    `);
    logger.info("contacts.tags migration applied");
  } catch (err) {
    logger.warn({ err }, "contacts.tags migration step failed (may already be applied)");
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contact_notes (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS contact_notes_contact_idx ON contact_notes(contact_id)
    `);
    logger.info("contact_notes migration applied");
  } catch (err) {
    logger.warn({ err }, "contact_notes migration step failed (may already be applied)");
  }

  try {
    await db.execute(sql`
      ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS from_email TEXT
    `);
    await db.execute(sql`
      ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS subject TEXT
    `);
    logger.info("campaigns email columns migration applied");
  } catch (err) {
    logger.warn({ err }, "campaigns email columns migration failed (may already be applied)");
  }
}

applyMigrations().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    refreshExpiredTokens().catch((e) => logger.warn({ err: e }, "Initial token refresh failed"));
    setInterval(() => {
      refreshExpiredTokens().catch((e) => logger.warn({ err: e }, "Token refresh job failed"));
    }, 24 * 60 * 60 * 1000);
  });
});
