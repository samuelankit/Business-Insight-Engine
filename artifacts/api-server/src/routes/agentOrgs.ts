import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  agentOrgChartsTable,
  agentOrgNodesTable,
  agentsTable,
  userSubscriptionsTable,
  agentLogsTable,
  agentPerformanceSnapshotsTable,
  businessesTable,
} from "@workspace/db/schema";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import { recordUsage, checkUsageLimit } from "../lib/usage.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";
import { getArchetypeBySlug, getArchetypesForVertical, TIER_AGENT_LIMITS } from "../data/archetypes.js";
import GORIGO_TEAM_CONFIG from "../data/gorigoTeam.js";
import { computeAgentPerformance, cacheKPISnapshot } from "../lib/kpiResolver.js";

const router = Router();
router.use(requireAuth);

const MS_24H = 24 * 60 * 60 * 1000;

/** Resolve the user's subscription plan. */
async function getUserPlan(userId: string): Promise<string> {
  const [sub] = await db
    .select()
    .from(userSubscriptionsTable)
    .where(eq(userSubscriptionsTable.userId, userId))
    .limit(1);
  return sub?.planId ?? "free";
}

/** Max agents for the given user plan. Infinity for unlimited. */
async function getAgentLimit(userId: string): Promise<number> {
  const planId = await getUserPlan(userId);
  return TIER_AGENT_LIMITS[planId] ?? 3;
}

/**
 * Verify that businessId is owned by userId.
 * Returns the business row or null.
 */
async function getOwnedBusiness(userId: string, businessId: string) {
  const [biz] = await db
    .select()
    .from(businessesTable)
    .where(
      and(
        eq(businessesTable.id, businessId),
        eq(businessesTable.userId, userId),
      ),
    )
    .limit(1);
  return biz ?? null;
}

/** Verify a chart belongs to the requesting user (non-deleted). */
async function getChartOwned(chartId: string, userId: string) {
  const [chart] = await db
    .select()
    .from(agentOrgChartsTable)
    .where(
      and(
        eq(agentOrgChartsTable.id, chartId),
        eq(agentOrgChartsTable.userId, userId),
        isNull(agentOrgChartsTable.deletedAt),
      ),
    )
    .limit(1);
  return chart ?? null;
}

/** Verify a node belongs to a chart owned by the requesting user. */
async function getNodeOwned(nodeId: string, userId: string) {
  const rows = await db
    .select({
      node: agentOrgNodesTable,
      chartBusinessId: agentOrgChartsTable.businessId,
    })
    .from(agentOrgNodesTable)
    .innerJoin(
      agentOrgChartsTable,
      and(
        eq(agentOrgNodesTable.orgChartId, agentOrgChartsTable.id),
        eq(agentOrgChartsTable.userId, userId),
        isNull(agentOrgChartsTable.deletedAt),
      ),
    )
    .where(eq(agentOrgNodesTable.id, nodeId))
    .limit(1);
  if (!rows[0]) return null;
  return { ...rows[0].node, chartBusinessId: rows[0].chartBusinessId };
}

// ─────────────────────────────────────────────────────────
// GET /agent-orgs/gorigo — GoRigo's own team (config-driven)
// ─────────────────────────────────────────────────────────
router.get("/gorigo", (_req, res) => {
  res.json(GORIGO_TEAM_CONFIG);
});

// ─────────────────────────────────────────────────────────
// GET /agent-orgs/archetypes — list available archetypes
// ─────────────────────────────────────────────────────────
router.get("/archetypes", (req, res) => {
  const { vertical = "general" } = req.query as { vertical?: string };
  const filtered = getArchetypesForVertical(vertical);
  res.json(filtered.map((a) => ({
    slug: a.slug,
    title: a.title,
    department: a.department,
    iconIdentifier: a.iconIdentifier,
    departmentColour: a.departmentColour,
    summary: a.summary,
    kpis: a.kpis,
    suggestedTools: a.suggestedTools,
    verticalTags: a.verticalTags,
  })));
});

// ─────────────────────────────────────────────────────────
// POST /agent-orgs/generate — AI brainstorm + org chart generation
// Tier gate: Free=3, Pro=15, Unlimited=no cap
// ─────────────────────────────────────────────────────────
const GenerateSchema = z.object({
  businessId: z.string().min(1),
  goalText: z.string().min(1).max(2000),
  vertical: z.string().optional().default("general"),
  businessType: z.string().optional(),
  targetAudience: z.string().optional(),
  existingTools: z.string().optional(),
  budgetScale: z.string().optional(),
});

const OrgNodeShape = z.object({
  archetypeSlug: z.string(),
  humanName: z.string(),
  roleSummary: z.string(),
  parentIndex: z.number().nullable(),
});

const GeneratedOrgShape = z.object({
  orgName: z.string(),
  vertical: z.string(),
  nodes: z.array(OrgNodeShape).min(1).max(50),
});

router.post("/generate", async (req, res, next) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { businessId, goalText, vertical, businessType, targetAudience, existingTools, budgetScale } = parsed.data;

    // Verify business ownership before any generation
    const business = await getOwnedBusiness(req.userId!, businessId);
    if (!business) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const { allowed } = await checkUsageLimit(req.userId!);
    if (!allowed) {
      res.status(429).json({ error: "usage_limit", upgrade: true });
      return;
    }

    const agentLimit = await getAgentLimit(req.userId!);
    const availableArchetypes = getArchetypesForVertical(vertical);
    const archetypeList = availableArchetypes
      .map((a) => `- ${a.slug}: ${a.title} (${a.department}) — ${a.summary}`)
      .join("\n");

    // For Unlimited plans (Infinity), use a practical max for the LLM prompt only
    const maxNodes = isFinite(agentLimit) ? agentLimit : 12;
    const contextSummary = [
      businessType ? `Business type: ${businessType}` : null,
      `Goal: ${goalText}`,
      targetAudience ? `Target audience: ${targetAudience}` : null,
      existingTools ? `Existing tools: ${existingTools}` : null,
      budgetScale ? `Budget scale: ${budgetScale}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are GoRigo's AI team architect. Design a virtual AI specialist team for a UK business based on their goals and context. Return ONLY valid JSON matching the required schema. Use only archetype slugs from the provided list. Human names should be professional and diverse. Role summaries should be personalised to the specific business context (2-3 sentences each). Do NOT use the term "employee" — use "AI Specialist" or "AI Agent". No marketing language. UK English only.`;

    const userMessage = `Design an AI specialist team for this business:

${contextSummary}

Industry vertical: ${vertical}
Suggested team size: up to ${maxNodes} AI specialists

Available archetypes (use only these slugs):
${archetypeList}

Return JSON matching exactly this schema:
{
  "orgName": "string (descriptive team name, e.g. 'Bloom Florist AI Operations')",
  "vertical": "string (the vertical slug)",
  "nodes": [
    {
      "archetypeSlug": "string (must match an available archetype slug exactly)",
      "humanName": "string (professional first name for the AI agent)",
      "roleSummary": "string (2-3 sentences personalised to this specific business)",
      "parentIndex": number | null (0-based index of parent node, null for root)
    }
  ]
}

Rules:
- The first node (index 0) must be the most senior/strategic role with parentIndex: null
- All other nodes should have a parentIndex pointing to their manager
- Maximum depth is 3 levels (root=0, direct report=1, sub-report=2)
- Every archetype slug must be valid from the list above`;

    let generatedOrg: z.infer<typeof GeneratedOrgShape> | null = null;
    let attempts = 0;

    while (attempts < 2 && !generatedOrg) {
      attempts++;
      try {
        const completion = await replitOpenAI.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2000,
        });

        const rawJson = completion.choices[0]?.message?.content ?? "{}";
        const parsed2 = GeneratedOrgShape.safeParse(JSON.parse(rawJson));
        if (parsed2.success) {
          generatedOrg = parsed2.data;
        } else {
          if (attempts >= 2) {
            res.status(500).json({ error: "Failed to generate a valid org chart. Please try again." });
            return;
          }
        }
      } catch (_e) {
        if (attempts >= 2) {
          res.status(500).json({ error: "AI generation failed. Please try again." });
          return;
        }
      }
    }

    if (!generatedOrg) {
      res.status(500).json({ error: "Failed to generate org chart after retries." });
      return;
    }

    // Validate all archetype slugs are real; fallback to first available
    const validSlugs = new Set(availableArchetypes.map((a) => a.slug));
    for (const node of generatedOrg.nodes) {
      if (!validSlugs.has(node.archetypeSlug)) {
        node.archetypeSlug = availableArchetypes[0]!.slug;
      }
    }

    await recordUsage(req.userId!, businessId, "org_generate");

    const tierLimitReached = isFinite(agentLimit)
      ? generatedOrg.nodes.length > agentLimit
      : false;

    const enforcedNodes = isFinite(agentLimit)
      ? generatedOrg.nodes.slice(0, agentLimit)
      : generatedOrg.nodes;

    const trimmedCount = generatedOrg.nodes.length - enforcedNodes.length;

    const responseNodes = enforcedNodes.map((n, i) => ({
      index: i,
      archetypeSlug: n.archetypeSlug,
      humanName: n.humanName,
      roleSummary: n.roleSummary,
      parentIndex: n.parentIndex,
      locked: false,
      archetype: (() => {
        const a = getArchetypeBySlug(n.archetypeSlug);
        return a ? {
          title: a.title,
          department: a.department,
          iconIdentifier: a.iconIdentifier,
          departmentColour: a.departmentColour,
          summary: a.summary,
          kpis: a.kpis,
        } : null;
      })(),
    }));

    res.json({
      orgName: generatedOrg.orgName,
      vertical: generatedOrg.vertical,
      agentLimit,
      tierLimitReached,
      trimmedCount,
      nodes: responseNodes,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// POST /agent-orgs — persist a confirmed org chart
// ─────────────────────────────────────────────────────────
const CreateOrgSchema = z.object({
  businessId: z.string(),
  orgName: z.string(),
  goalText: z.string(),
  vertical: z.string().default("general"),
  nodes: z.array(z.object({
    archetypeSlug: z.string(),
    humanName: z.string(),
    roleSummary: z.string(),
    parentIndex: z.number().nullable(),
  })),
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = CreateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { businessId, orgName, goalText, vertical, nodes } = parsed.data;

    // Verify business ownership
    const business = await getOwnedBusiness(req.userId!, businessId);
    if (!business) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const agentLimit = await getAgentLimit(req.userId!);
    if (isFinite(agentLimit) && nodes.length > agentLimit) {
      res.status(403).json({
        error: "tier_limit",
        message: `Your plan allows up to ${agentLimit} AI agents in an org chart. Please upgrade to add more.`,
        agentLimit,
      });
      return;
    }

    // Enforce max depth <= 5 at application level
    const MAX_DEPTH = 5;
    function computeDepth(index: number, visited = new Set<number>()): number {
      if (visited.has(index)) return 0;
      visited.add(index);
      const node = nodes[index]!;
      if (node.parentIndex === null || node.parentIndex >= index) return 0;
      return 1 + computeDepth(node.parentIndex, new Set(visited));
    }
    for (let i = 0; i < nodes.length; i++) {
      if (computeDepth(i) > MAX_DEPTH) {
        res.status(400).json({ error: "Org chart exceeds maximum depth of 5 levels." });
        return;
      }
    }

    const chartId = generateToken(16);
    await db.insert(agentOrgChartsTable).values({
      id: chartId,
      userId: req.userId!,
      businessId,
      name: orgName,
      goalText,
      verticalSlug: vertical,
      status: "active",
      nodeCount: nodes.length,
    });

    const createdNodeIds: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const archetype = getArchetypeBySlug(node.archetypeSlug);
      const agentId = generateToken(16);

      await db.insert(agentsTable).values({
        id: agentId,
        userId: req.userId!,
        businessId,
        type: node.archetypeSlug,
        name: `${node.humanName} (${archetype?.title ?? node.archetypeSlug})`,
        description: node.roleSummary,
        systemPrompt: archetype?.systemPrompt ?? `You are ${node.humanName}, an AI specialist for this business.`,
        toolAccess: archetype?.suggestedTools ?? [],
        isBuiltIn: false,
        isActive: true,
      });

      const nodeId = generateToken(16);
      const parentNodeId = node.parentIndex !== null && node.parentIndex < i
        ? createdNodeIds[node.parentIndex]
        : null;
      const depth = computeDepth(i);

      await db.insert(agentOrgNodesTable).values({
        id: nodeId,
        orgChartId: chartId,
        agentId,
        archetypeSlug: node.archetypeSlug,
        parentNodeId,
        depth,
        displayOrder: i,
        humanName: node.humanName,
        roleSummary: node.roleSummary,
        department: archetype?.department ?? "Operations",
      });

      createdNodeIds.push(nodeId);
    }

    const [chart] = await db
      .select()
      .from(agentOrgChartsTable)
      .where(eq(agentOrgChartsTable.id, chartId))
      .limit(1);

    res.status(201).json(mapChart(chart!));
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /agent-orgs — list org charts for a business
// ─────────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { businessId } = req.query as { businessId?: string };
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    // Only list charts for businesses the user owns
    const business = await getOwnedBusiness(req.userId!, businessId);
    if (!business) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const charts = await db
      .select()
      .from(agentOrgChartsTable)
      .where(
        and(
          eq(agentOrgChartsTable.userId, req.userId!),
          eq(agentOrgChartsTable.businessId, businessId),
          isNull(agentOrgChartsTable.deletedAt),
        ),
      )
      .orderBy(desc(agentOrgChartsTable.createdAt));

    res.json(charts.map(mapChart));
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /agent-orgs/:id — full tree (ownership verified)
// ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const chart = await getChartOwned(req.params.id!, req.userId!);
    if (!chart) {
      res.status(404).json({ error: "Org chart not found" });
      return;
    }

    const nodes = await db
      .select({
        nodeId: agentOrgNodesTable.id,
        orgChartId: agentOrgNodesTable.orgChartId,
        agentId: agentOrgNodesTable.agentId,
        archetypeSlug: agentOrgNodesTable.archetypeSlug,
        parentNodeId: agentOrgNodesTable.parentNodeId,
        depth: agentOrgNodesTable.depth,
        displayOrder: agentOrgNodesTable.displayOrder,
        humanName: agentOrgNodesTable.humanName,
        roleSummary: agentOrgNodesTable.roleSummary,
        department: agentOrgNodesTable.department,
        agentName: agentsTable.name,
        agentIsActive: agentsTable.isActive,
        agentLastRunAt: agentsTable.lastRunAt,
      })
      .from(agentOrgNodesTable)
      .leftJoin(agentsTable, eq(agentOrgNodesTable.agentId, agentsTable.id))
      .where(eq(agentOrgNodesTable.orgChartId, req.params.id!))
      .orderBy(agentOrgNodesTable.depth, agentOrgNodesTable.displayOrder);

    const agentLimit = await getAgentLimit(req.userId!);

    res.json({
      ...mapChart(chart),
      agentLimit,
      nodes: nodes.map((n) => {
        const archetype = getArchetypeBySlug(n.archetypeSlug);
        return {
          id: n.nodeId,
          agentId: n.agentId,
          archetypeSlug: n.archetypeSlug,
          parentNodeId: n.parentNodeId,
          depth: n.depth,
          displayOrder: n.displayOrder,
          humanName: n.humanName,
          roleSummary: n.roleSummary,
          department: n.department,
          agentIsActive: n.agentIsActive,
          agentLastRunAt: n.agentLastRunAt?.toISOString() ?? null,
          statusIndicator: getStatusFromLastRun(n.agentLastRunAt),
          archetype: archetype ? {
            title: archetype.title,
            iconIdentifier: archetype.iconIdentifier,
            departmentColour: archetype.departmentColour,
            responsibilities: archetype.responsibilities,
            kpis: archetype.kpis,
          } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /agent-orgs/:id/performance — KPI snapshots for all nodes
// 24h cached: checks agentPerformanceSnapshotsTable before recomputing
// Ownership verified via getChartOwned
// ─────────────────────────────────────────────────────────
router.get("/:id/performance", async (req, res, next) => {
  try {
    const chart = await getChartOwned(req.params.id!, req.userId!);
    if (!chart) {
      res.status(404).json({ error: "Org chart not found" });
      return;
    }

    const nodes = await db
      .select({
        nodeId: agentOrgNodesTable.id,
        agentId: agentOrgNodesTable.agentId,
        archetypeSlug: agentOrgNodesTable.archetypeSlug,
        humanName: agentOrgNodesTable.humanName,
      })
      .from(agentOrgNodesTable)
      .where(eq(agentOrgNodesTable.orgChartId, req.params.id!));

    const performances = await Promise.all(
      nodes.map((n) => computeAgentPerformance(n.agentId, n.archetypeSlug)),
    );

    res.json(
      nodes.map((n, i) => ({
        nodeId: n.nodeId,
        humanName: n.humanName,
        ...performances[i]!,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /agent-orgs/:id — soft delete
// ─────────────────────────────────────────────────────────
router.delete("/:id", async (req, res, next) => {
  try {
    await db
      .update(agentOrgChartsTable)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(
        and(
          eq(agentOrgChartsTable.id, req.params.id!),
          eq(agentOrgChartsTable.userId, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// GET /agent-orgs/nodes/:nodeId/performance — single node performance
// Ownership verified via inner join through chart
// ─────────────────────────────────────────────────────────
router.get("/nodes/:nodeId/performance", async (req, res, next) => {
  try {
    const node = await getNodeOwned(req.params.nodeId!, req.userId!);
    if (!node) {
      res.status(404).json({ error: "Node not found" });
      return;
    }

    // 24h cache: check for a valid cached performance snapshot before recomputing
    const PERF_CACHE_KEY = "perf_summary_cache";
    const [cachedPerf] = await db
      .select()
      .from(agentPerformanceSnapshotsTable)
      .where(
        and(
          eq(agentPerformanceSnapshotsTable.agentId, node.agentId),
          eq(agentPerformanceSnapshotsTable.metricKey, PERF_CACHE_KEY),
        ),
      )
      .orderBy(desc(agentPerformanceSnapshotsTable.updatedAt))
      .limit(1);

    if (
      cachedPerf?.metricLabel &&
      cachedPerf.updatedAt &&
      Date.now() - cachedPerf.updatedAt.getTime() < MS_24H
    ) {
      try {
        const cached = JSON.parse(cachedPerf.metricLabel);
        res.json({ nodeId: node.id, humanName: node.humanName, ...cached, cached: true });
        return;
      } catch {
        // corrupt cache; fall through to recompute
      }
    }

    const perf = await computeAgentPerformance(node.agentId, node.archetypeSlug);

    // Persist the computed summary as a 24h cache entry
    await cacheKPISnapshot(node.agentId, PERF_CACHE_KEY, 1, JSON.stringify(perf));

    res.json({ nodeId: node.id, humanName: node.humanName, ...perf, cached: false });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
// POST /agent-orgs/nodes/:nodeId/assessment — AI assessment (24h cached)
// Ownership verified. Checks cache before calling LLM.
// ─────────────────────────────────────────────────────────
router.post("/nodes/:nodeId/assessment", async (req, res, next) => {
  try {
    const node = await getNodeOwned(req.params.nodeId!, req.userId!);
    if (!node) {
      res.status(404).json({ error: "Node not found" });
      return;
    }

    // Check 24h assessment cache BEFORE calling LLM
    const [cached] = await db
      .select()
      .from(agentPerformanceSnapshotsTable)
      .where(
        and(
          eq(agentPerformanceSnapshotsTable.agentId, node.agentId),
          eq(agentPerformanceSnapshotsTable.metricKey, "assessment_paragraph"),
        ),
      )
      .orderBy(desc(agentPerformanceSnapshotsTable.updatedAt))
      .limit(1);

    if (cached?.updatedAt && cached.metricLabel) {
      const ageMs = Date.now() - cached.updatedAt.getTime();
      if (ageMs < MS_24H) {
        res.json({
          assessmentParagraph: cached.metricLabel,
          assessmentCachedAt: cached.updatedAt.toISOString(),
          cached: true,
        });
        return;
      }
    }

    const { allowed } = await checkUsageLimit(req.userId!);
    if (!allowed) {
      res.status(429).json({ error: "usage_limit", upgrade: true });
      return;
    }

    const perf = await computeAgentPerformance(node.agentId, node.archetypeSlug);
    const archetype = getArchetypeBySlug(node.archetypeSlug);

    const completion = await replitOpenAI.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "You are GoRigo's AI performance analyst. Write concise, actionable performance assessments for AI agents. Use British English. Never use the word 'employee'. Max 150 words.",
        },
        {
          role: "user",
          content: `Write a performance assessment for this AI agent:
Name: ${node.humanName}
Role: ${archetype?.title ?? node.archetypeSlug}
Total runs: ${perf.totalRuns}
Success rate: ${perf.successRate}%
Last active: ${perf.lastRunAt ? new Date(perf.lastRunAt).toLocaleDateString("en-GB") : "Never"}
Last output preview: ${perf.lastOutput ?? "No runs yet"}

Include: 1) Current performance summary, 2) One specific improvement recommendation, 3) One next action to take.`,
        },
      ],
      max_completion_tokens: 300,
    });

    const paragraph = completion.choices[0]?.message?.content ?? "Assessment unavailable.";
    const assessmentTime = new Date();

    await cacheKPISnapshot(node.agentId, "assessment_paragraph", 1, paragraph);
    await recordUsage(req.userId!, node.chartBusinessId, "org_assessment");

    res.json({
      assessmentParagraph: paragraph,
      assessmentCachedAt: assessmentTime.toISOString(),
      cached: false,
    });
  } catch (err) {
    next(err);
  }
});

function mapChart(c: typeof agentOrgChartsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    goalText: c.goalText,
    verticalSlug: c.verticalSlug,
    status: c.status,
    nodeCount: c.nodeCount,
    businessId: c.businessId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function getStatusFromLastRun(lastRunAt: Date | null): "green" | "amber" | "red" {
  if (!lastRunAt) return "red";
  const diffMs = Date.now() - lastRunAt.getTime();
  if (diffMs < 24 * 60 * 60 * 1000) return "green";
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return "amber";
  return "red";
}

export default router;
