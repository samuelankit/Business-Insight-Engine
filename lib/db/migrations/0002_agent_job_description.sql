-- Migration: Agent Job Description Column (Task #9)
-- Adds a nullable job_description column to the agents table.
-- Safe to re-run: uses IF NOT EXISTS guard via ADD COLUMN IF NOT EXISTS.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "job_description" TEXT;
