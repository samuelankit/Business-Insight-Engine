-- Migration: AI Agent Organisational Hierarchy (Task #6)
-- Creates tables for org charts, org nodes, and agent performance snapshots.
-- Run this migration once against each environment (development + production).
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- ─── 1. Agent Org Charts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_org_charts" (
  "id"            TEXT        PRIMARY KEY,
  "user_id"       TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "business_id"   TEXT        NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name"          TEXT        NOT NULL,
  "goal_text"     TEXT        NOT NULL,
  "vertical_slug" TEXT        NOT NULL DEFAULT 'general',
  "status"        TEXT        NOT NULL DEFAULT 'draft',
  "node_count"    INTEGER     NOT NULL DEFAULT 0,
  "deleted_at"    TIMESTAMP,
  "created_at"    TIMESTAMP   NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "org_charts_user_idx"     ON "agent_org_charts" ("user_id");
CREATE INDEX IF NOT EXISTS "org_charts_business_idx" ON "agent_org_charts" ("business_id");
CREATE INDEX IF NOT EXISTS "org_charts_status_idx"   ON "agent_org_charts" ("status");

-- ─── 2. Agent Org Nodes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_org_nodes" (
  "id"              TEXT      PRIMARY KEY,
  "org_chart_id"    TEXT      NOT NULL REFERENCES "agent_org_charts"("id") ON DELETE CASCADE,
  "agent_id"        TEXT      NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "archetype_slug"  TEXT      NOT NULL,
  "parent_node_id"  TEXT,
  "depth"           INTEGER   NOT NULL DEFAULT 0,
  "display_order"   INTEGER   NOT NULL DEFAULT 0,
  "human_name"      TEXT      NOT NULL,
  "role_summary"    TEXT      NOT NULL,
  "department"      TEXT      NOT NULL,
  "created_at"      TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "org_nodes_chart_idx"  ON "agent_org_nodes" ("org_chart_id");
CREATE INDEX IF NOT EXISTS "org_nodes_agent_idx"  ON "agent_org_nodes" ("agent_id");
CREATE INDEX IF NOT EXISTS "org_nodes_parent_idx" ON "agent_org_nodes" ("parent_node_id");

-- ─── 3. Agent Performance Snapshots ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_performance_snapshots" (
  "id"            TEXT      PRIMARY KEY,
  "agent_id"      TEXT      NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "snapshot_date" DATE      NOT NULL,
  "metric_key"    TEXT      NOT NULL,
  "metric_value"  REAL      NOT NULL DEFAULT 0,
  "metric_label"  TEXT,
  "created_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "perf_snapshots_agent_idx"  ON "agent_performance_snapshots" ("agent_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "perf_snapshots_date_idx"   ON "agent_performance_snapshots" ("snapshot_date");
CREATE INDEX IF NOT EXISTS "perf_snapshots_metric_idx" ON "agent_performance_snapshots" ("agent_id", "metric_key");
