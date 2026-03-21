import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { agentsTable, agentLogsTable, agentPendingActionsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

const TEMPLATES = [
  {
    id: "marketing",
    name: "Marketing Agent",
    description: "Automates social media posts, email campaigns, and content creation",
    type: "marketing",
    systemPrompt: "You are a marketing specialist. Help create compelling content, plan campaigns, and manage social media presence for the business.",
    suggestedTools: ["gmail", "slack", "facebook", "linkedin", "twitter"],
  },
  {
    id: "operations",
    name: "Operations Agent",
    description: "Manages scheduling, task tracking, and operational workflows",
    type: "operations",
    systemPrompt: "You are an operations manager. Help streamline business processes, track tasks, and ensure smooth day-to-day operations.",
    suggestedTools: ["notion", "trello", "google_calendar", "slack"],
  },
  {
    id: "finance",
    name: "Finance Agent",
    description: "Tracks invoices, expenses, and financial reporting",
    type: "finance",
    systemPrompt: "You are a financial analyst. Help track income, manage expenses, create invoices, and provide financial insights.",
    suggestedTools: ["xero", "stripe"],
  },
  {
    id: "comms",
    name: "Communications Agent",
    description: "Manages customer communications and follow-ups",
    type: "comms",
    systemPrompt: "You are a communications specialist. Help manage customer interactions, draft responses, and maintain relationships.",
    suggestedTools: ["gmail", "slack", "whatsapp"],
  },
  {
    id: "strategy",
    name: "Strategy Agent",
    description: "Conducts research and provides strategic business insights",
    type: "strategy",
    systemPrompt: "You are a business strategist. Help with market research, competitive analysis, and strategic planning.",
    suggestedTools: ["notion", "google_sheets"],
  },
];

router.get("/templates", (_req, res) => {
  res.json(TEMPLATES);
});

router.get("/approvals/pending", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    const conditions = [
      eq(agentPendingActionsTable.userId, req.userId!),
      eq(agentPendingActionsTable.status, "pending"),
    ];
    if (businessId) {
      conditions.push(eq(agentPendingActionsTable.businessId, businessId as string));
    }

    const actions = await db
      .select()
      .from(agentPendingActionsTable)
      .where(and(...conditions))
      .orderBy(desc(agentPendingActionsTable.createdAt));

    res.json(actions.map(mapApproval));
  } catch (err) {
    next(err);
  }
});

router.post("/approvals/:actionId/approve", async (req, res, next) => {
  try {
    await db
      .update(agentPendingActionsTable)
      .set({ status: "approved", resolvedAt: new Date() })
      .where(
        and(
          eq(agentPendingActionsTable.id, req.params.actionId!),
          eq(agentPendingActionsTable.userId, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/approvals/:actionId/reject", async (req, res, next) => {
  try {
    await db
      .update(agentPendingActionsTable)
      .set({ status: "rejected", resolvedAt: new Date() })
      .where(
        and(
          eq(agentPendingActionsTable.id, req.params.actionId!),
          eq(agentPendingActionsTable.userId, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const agents = await db
      .select()
      .from(agentsTable)
      .where(
        and(
          eq(agentsTable.userId, req.userId!),
          eq(agentsTable.businessId, businessId as string),
        ),
      );

    res.json(agents.map(mapAgent));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { businessId, name, description, systemPrompt, toolAccess = [] } = req.body;

    if (!businessId || !name || !systemPrompt) {
      res.status(400).json({ error: "businessId, name, and systemPrompt are required" });
      return;
    }

    const id = generateToken(16);
    await db.insert(agentsTable).values({
      id,
      userId: req.userId!,
      businessId,
      name,
      description,
      systemPrompt,
      toolAccess,
      type: "custom",
    });

    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
    res.status(201).json(mapAgent(agent!));
  } catch (err) {
    next(err);
  }
});

router.patch("/:agentId", async (req, res, next) => {
  try {
    const agent = await db
      .select()
      .from(agentsTable)
      .where(
        and(
          eq(agentsTable.id, req.params.agentId!),
          eq(agentsTable.userId, req.userId!),
        ),
      );

    if (!agent.length) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const allowed = ["name", "description", "systemPrompt", "isActive", "scheduleType", "scheduleTime", "scheduleDay", "scheduleInterval", "toolAccess"];
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key === "systemPrompt" ? "systemPrompt" : key] = req.body[key];
    }

    await db.update(agentsTable).set(updates).where(eq(agentsTable.id, req.params.agentId!));
    const [updated] = await db.select().from(agentsTable).where(eq(agentsTable.id, req.params.agentId!));
    res.json(mapAgent(updated!));
  } catch (err) {
    next(err);
  }
});

router.post("/:agentId/run", async (req, res, next) => {
  try {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(
        and(eq(agentsTable.id, req.params.agentId!), eq(agentsTable.userId, req.userId!)),
      );

    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const summary = `Agent "${agent.name}" ran successfully and analysed business data.`;
    await db.insert(agentLogsTable).values({
      id: generateToken(16),
      agentId: agent.id,
      userId: req.userId!,
      businessId: req.body.businessId ?? agent.businessId,
      summary,
      actions: [],
    });

    await db.update(agentsTable).set({ lastRunAt: new Date() }).where(eq(agentsTable.id, agent.id));

    res.json({ summary, actions: [], isPreview: false });
  } catch (err) {
    next(err);
  }
});

router.post("/:agentId/test-run", async (req, res, next) => {
  try {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(
        and(eq(agentsTable.id, req.params.agentId!), eq(agentsTable.userId, req.userId!)),
      );

    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({ summary: `[TEST] Agent "${agent.name}" preview run completed. No actions were executed.`, actions: [], isPreview: true });
  } catch (err) {
    next(err);
  }
});

router.get("/:agentId/logs", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    const logs = await db
      .select()
      .from(agentLogsTable)
      .where(eq(agentLogsTable.agentId, req.params.agentId!))
      .orderBy(desc(agentLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(logs.map((l) => ({
      id: l.id,
      agentId: l.agentId,
      summary: l.summary,
      createdAt: l.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

function mapAgent(a: typeof agentsTable.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    type: a.type,
    isActive: a.isActive,
    isBuiltIn: a.isBuiltIn,
    businessId: a.businessId,
    scheduleType: a.scheduleType,
    scheduleTime: a.scheduleTime,
    scheduleDay: a.scheduleDay,
    scheduleInterval: a.scheduleInterval,
    nextRunAt: a.nextRunAt?.toISOString() ?? null,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    toolAccess: a.toolAccess as string[],
    createdAt: a.createdAt.toISOString(),
  };
}

function mapApproval(a: typeof agentPendingActionsTable.$inferSelect) {
  return {
    id: a.id,
    agentId: a.agentId,
    actionType: a.actionType,
    actionDescription: a.actionDescription,
    toolName: a.toolName,
    functionName: a.functionName,
    status: a.status,
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

export default router;
