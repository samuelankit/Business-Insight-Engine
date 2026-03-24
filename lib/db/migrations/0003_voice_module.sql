-- Migration: AI Voice Module (Task #11)
-- Adds voice_calls, voice_sessions tables and extends voice_preferences and telnyx_configs.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS / ADD COLUMN IF NOT EXISTS guards.

-- ─── 1. Extend voice_preferences ────────────────────────────────────────────

ALTER TABLE "voice_preferences"
  ADD COLUMN IF NOT EXISTS "input_locale"   TEXT    NOT NULL DEFAULT 'en-GB',
  ADD COLUMN IF NOT EXISTS "output_locale"  TEXT    NOT NULL DEFAULT 'en-GB',
  ADD COLUMN IF NOT EXISTS "voice_pin_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "voice_activated" BOOLEAN NOT NULL DEFAULT false;

-- Rename default provider from 'google' to 'openai' for new rows (non-destructive)
-- Existing rows keep their provider value.

-- ─── 2. Extend telnyx_configs ───────────────────────────────────────────────

-- Add user_id column (nullable first, then fill existing rows with business owner id)
ALTER TABLE "telnyx_configs"
  ADD COLUMN IF NOT EXISTS "user_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "agent_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "is_active"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "monthly_fee_pence" TEXT    NOT NULL DEFAULT '299';

-- Backfill user_id from the linked business for existing rows
UPDATE "telnyx_configs" tc
SET "user_id" = b."user_id"
FROM "businesses" b
WHERE tc."business_id" = b."id"
  AND tc."user_id" IS NULL;

-- Drop the old unique constraint on business_id if it exists
-- (allows multiple numbers per business going forward)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telnyx_configs_business_id_unique'
  ) THEN
    ALTER TABLE "telnyx_configs" DROP CONSTRAINT "telnyx_configs_business_id_unique";
  END IF;
END $$;

-- Add FK for user_id (only after backfill)
ALTER TABLE "telnyx_configs"
  ADD CONSTRAINT IF NOT EXISTS "telnyx_configs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add index on user_id for IDOR-safe lookups
CREATE INDEX IF NOT EXISTS "telnyx_configs_user_idx" ON "telnyx_configs" ("user_id");

-- ─── 3. Create voice_calls ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "voice_calls" (
  "id"                  TEXT        PRIMARY KEY,
  "user_id"             TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "business_id"         TEXT        NOT NULL,
  "agent_id"            TEXT,
  "agent_name"          TEXT,
  "direction"           TEXT        NOT NULL DEFAULT 'outbound',
  "duration_seconds"    TEXT,
  "transcript_summary"  TEXT,
  "transcript"          TEXT,
  "credits_used"        TEXT        NOT NULL DEFAULT '0',
  "created_at"          TIMESTAMP   NOT NULL DEFAULT NOW()
);

ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "agent_name" TEXT;

CREATE INDEX IF NOT EXISTS "voice_calls_user_idx"     ON "voice_calls" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "voice_calls_business_idx" ON "voice_calls" ("business_id");

-- ─── 4. Create voice_sessions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "voice_sessions" (
  "id"            TEXT      PRIMARY KEY,
  "user_id"       TEXT      NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_token" TEXT      NOT NULL UNIQUE,
  "expires_at"    TIMESTAMP NOT NULL,
  "created_at"    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "voice_sessions_user_idx"  ON "voice_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "voice_sessions_token_idx" ON "voice_sessions" ("session_token");
