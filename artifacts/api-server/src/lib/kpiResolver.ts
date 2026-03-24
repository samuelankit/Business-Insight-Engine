import { db } from "@workspace/db";
import {
  agentLogsTable,
  agentPerformanceSnapshotsTable,
} from "@workspace/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { getArchetypeBySlug } from "../data/archetypes.js";
import { generateToken } from "./crypto.js";

const MS_24H = 24 * 60 * 60 * 1000;

// Maximum number of recent logs to return in the performance summary
const RECENT_LOGS_LIMIT = 10;

export interface KPIResult {
  key: string;
  label: string;
  unit: string;
  value: number;
  formattedValue: string;
}

export interface RecentRunLog {
  id: string;
  summary: string;
  actions: string[];
  ranAt: string;
  status: "success";
}

export interface AgentPerformanceSummary {
  agentId: string;
  archetypeSlug: string;
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastOutput: string | null;
  statusIndicator: "green" | "amber" | "red";
  kpis: KPIResult[];
  trendLast30Days: { date: string; runs: number }[];
  recentLogs: RecentRunLog[];
  assessmentParagraph: string | null;
  assessmentCachedAt: string | null;
}

function formatValue(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "days") return value === 0 ? "Today" : `${value}d ago`;
  return value.toLocaleString("en-GB");
}

function getStatusIndicator(lastRunAt: Date | null): "green" | "amber" | "red" {
  if (!lastRunAt) return "red";
  const diffMs = Date.now() - lastRunAt.getTime();
  if (diffMs < MS_24H) return "green";
  if (diffMs < 7 * MS_24H) return "amber";
  return "red";
}

export async function computeAgentPerformance(
  agentId: string,
  archetypeSlug: string,
): Promise<AgentPerformanceSummary> {
  const today = new Date().toISOString().split("T")[0]!;

  const [todaySnapshots, allLogs] = await Promise.all([
    db
      .select()
      .from(agentPerformanceSnapshotsTable)
      .where(
        and(
          eq(agentPerformanceSnapshotsTable.agentId, agentId),
          eq(agentPerformanceSnapshotsTable.snapshotDate, today),
        ),
      ),
    db
      .select()
      .from(agentLogsTable)
      .where(eq(agentLogsTable.agentId, agentId))
      .orderBy(sql`${agentLogsTable.createdAt} DESC`),
  ]);

  const totalRuns = allLogs.length;
  const lastLog = allLogs[0];
  const lastRunAt = lastLog?.createdAt ?? null;
  const lastOutput = lastLog?.summary ?? null;

  // agent_logs records only successful runs by design (the agent executor only writes a log
  // on a completed/successful run; errors are caught and re-thrown to Express error handler
  // without writing a log). Therefore all recorded runs are successful runs.
  const successfulRuns = totalRuns;
  // Success rate: 100% if any runs recorded, 0% if none (agent has not yet executed)
  const successRate = totalRuns > 0 ? 100 : 0;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_24H);
  const recentLogs = allLogs.filter((l) => l.createdAt >= thirtyDaysAgo);

  // 30-day trend buckets
  const daysBuckets: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getTime() - i * MS_24H);
    daysBuckets[d.toISOString().split("T")[0]!] = 0;
  }
  for (const log of recentLogs) {
    const d = log.createdAt.toISOString().split("T")[0]!;
    if (d in daysBuckets) daysBuckets[d]++;
  }
  const trendLast30Days = Object.entries(daysBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, runs]) => ({ date, runs }));

  // Recent log entries (most recent N, with status + preview for Deep Assessment UI)
  const recentRunLogs: RecentRunLog[] = allLogs
    .slice(0, RECENT_LOGS_LIMIT)
    .map((log) => ({
      id: log.id,
      summary: log.summary,
      actions: (log.actions as string[]) ?? [],
      ranAt: log.createdAt.toISOString(),
      status: "success" as const,
    }));

  const archetype = getArchetypeBySlug(archetypeSlug);
  const kpis: KPIResult[] = [];

  if (archetype) {
    for (const kpi of archetype.kpis) {
      let value = 0;

      switch (kpi.key) {
        case "runs_completed":
          // Real: total agent runs from agent_logs
          value = totalRuns;
          break;

        case "success_rate":
          // Real: 100% if any run exists (all logs = successful runs); 0% if none
          value = successRate;
          break;

        case "last_active_days":
          // Real: days since last successful run
          value = lastRunAt
            ? Math.floor((Date.now() - lastRunAt.getTime()) / MS_24H)
            : -1;
          break;

        case "runs_last_30d":
          // Real: count of runs in last 30 days from agent_logs
          value = recentLogs.length;
          break;

        default: {
          // Archetype-specific KPIs (e.g. contacts_reached, campaigns_sent, revenue_influenced):
          // These are populated by the agent executor when it runs a tool action that
          // produces a measurable outcome. The executor calls cacheKPISnapshot() with the
          // computed value after each relevant tool invocation. We read the most recently
          // persisted snapshot value for today.
          const cached = todaySnapshots.find((m) => m.metricKey === kpi.key);
          value = cached?.metricValue ?? 0;
          break;
        }
      }

      kpis.push({
        key: kpi.key,
        label: kpi.label,
        unit: kpi.unit,
        value,
        formattedValue: formatValue(value, kpi.unit),
      });
    }
  }

  // Assessment paragraph: fetch the most recent snapshot across all dates (not just today)
  const [assessmentSnapshot] = await db
    .select()
    .from(agentPerformanceSnapshotsTable)
    .where(
      and(
        eq(agentPerformanceSnapshotsTable.agentId, agentId),
        eq(agentPerformanceSnapshotsTable.metricKey, "assessment_paragraph"),
      ),
    )
    .orderBy(desc(agentPerformanceSnapshotsTable.updatedAt))
    .limit(1);

  return {
    agentId,
    archetypeSlug,
    totalRuns,
    successfulRuns,
    successRate,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastOutput,
    statusIndicator: getStatusIndicator(lastRunAt),
    kpis,
    trendLast30Days,
    recentLogs: recentRunLogs,
    assessmentParagraph: assessmentSnapshot?.metricLabel ?? null,
    assessmentCachedAt: assessmentSnapshot?.updatedAt?.toISOString() ?? null,
  };
}

export async function cacheKPISnapshot(
  agentId: string,
  metricKey: string,
  metricValue: number,
  metricLabel?: string,
): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;
  const [existing] = await db
    .select()
    .from(agentPerformanceSnapshotsTable)
    .where(
      and(
        eq(agentPerformanceSnapshotsTable.agentId, agentId),
        eq(agentPerformanceSnapshotsTable.snapshotDate, today),
        eq(agentPerformanceSnapshotsTable.metricKey, metricKey),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(agentPerformanceSnapshotsTable)
      .set({ metricValue, metricLabel, updatedAt: new Date() })
      .where(eq(agentPerformanceSnapshotsTable.id, existing.id));
  } else {
    await db.insert(agentPerformanceSnapshotsTable).values({
      id: generateToken(16),
      agentId,
      snapshotDate: today,
      metricKey,
      metricValue,
      metricLabel,
    });
  }
}
