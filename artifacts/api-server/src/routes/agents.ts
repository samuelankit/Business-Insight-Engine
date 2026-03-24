import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { agentsTable, agentLogsTable, agentPendingActionsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import { checkWalletAndDebit, getEventCost, recordUsage } from "../lib/usage.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import mammoth from "mammoth";
import { extractPDFText } from "../lib/pdfExtract.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

const JD_TEMPLATES = [
  {
    id: "marketing-manager",
    roleTitle: "Marketing Manager",
    description: "Drives brand awareness and demand generation",
    jobDescription: `Role: Marketing Manager

Responsibilities:
- Develop and execute integrated marketing campaigns across digital and offline channels
- Manage social media presence, content calendar, and brand voice
- Analyse campaign performance metrics and optimise ROI
- Coordinate with sales team to align marketing with revenue goals
- Oversee email marketing, SEO, and paid advertising strategies
- Manage agency and freelancer relationships
- Prepare monthly marketing reports for leadership

Key Performance Indicators:
- Lead generation volume and quality
- Cost per acquisition (CPA)
- Brand reach and engagement rates
- Campaign ROI

Skills Required:
- 3+ years in digital marketing
- Proficiency in CRM, Google Analytics, and ad platforms
- Strong written and verbal communication
- Data-driven mindset with creative problem-solving ability`,
  },
  {
    id: "operations-manager",
    roleTitle: "Operations Manager",
    description: "Ensures smooth day-to-day business operations",
    jobDescription: `Role: Operations Manager

Responsibilities:
- Oversee daily operational workflows and ensure process efficiency
- Manage vendor relationships, procurement, and supply chain logistics
- Identify bottlenecks and implement process improvements
- Coordinate cross-functional teams to meet project deadlines
- Monitor KPIs and prepare operational reports
- Ensure compliance with company policies and regulatory requirements
- Handle escalations and resolve operational issues promptly

Key Performance Indicators:
- Operational cost efficiency
- Process cycle times
- Team productivity metrics
- Compliance adherence rate

Skills Required:
- 3+ years in operations or project management
- Strong analytical and problem-solving skills
- Experience with project management tools (Notion, Trello, Asana)
- Excellent communication and leadership abilities`,
  },
  {
    id: "financial-analyst",
    roleTitle: "Financial Analyst",
    description: "Tracks finances and provides strategic financial insights",
    jobDescription: `Role: Financial Analyst

Responsibilities:
- Monitor revenue, expenses, and cash flow on a daily/weekly basis
- Prepare financial statements, forecasts, and budget reports
- Analyse financial data to identify trends and opportunities
- Manage invoicing, accounts payable, and accounts receivable
- Support tax compliance and liaise with external accountants
- Provide financial modelling for business decisions
- Track and report on departmental budgets

Key Performance Indicators:
- Forecast accuracy
- Days Sales Outstanding (DSO)
- Budget variance
- Financial report turnaround time

Skills Required:
- Degree in Finance, Accounting, or related field
- Proficiency in accounting software (Xero, QuickBooks)
- Advanced Excel / Google Sheets skills
- Attention to detail and strong numerical ability`,
  },
  {
    id: "customer-success-manager",
    roleTitle: "Customer Success Manager",
    description: "Ensures customers achieve their desired outcomes",
    jobDescription: `Role: Customer Success Manager

Responsibilities:
- Onboard new customers and guide them through product adoption
- Build long-term relationships with key accounts
- Monitor customer health scores and proactively address churn risk
- Conduct regular check-in calls and business reviews
- Gather product feedback and relay to the product team
- Manage renewals and identify upsell opportunities
- Resolve escalated customer issues swiftly

Key Performance Indicators:
- Net Promoter Score (NPS)
- Customer retention rate
- Upsell/expansion revenue
- Time to first value (TTFV)

Skills Required:
- 2+ years in customer success or account management
- Excellent interpersonal and communication skills
- Experience with CRM tools (HubSpot, Salesforce)
- Empathetic problem-solving approach`,
  },
  {
    id: "sales-executive",
    roleTitle: "Sales Executive",
    description: "Drives revenue growth through proactive outreach and deal closing",
    jobDescription: `Role: Sales Executive

Responsibilities:
- Prospect and qualify new business opportunities
- Conduct discovery calls, demos, and follow-up activities
- Manage pipeline using CRM software
- Negotiate contracts and close deals to meet revenue targets
- Collaborate with marketing for lead generation campaigns
- Build relationships with decision-makers at target accounts
- Provide accurate sales forecasts to management

Key Performance Indicators:
- Monthly/quarterly revenue attainment
- Pipeline coverage ratio
- Win rate
- Average deal size

Skills Required:
- 2+ years in B2B sales
- Proven track record of hitting quotas
- Strong negotiation and presentation skills
- Proficiency with CRM tools`,
  },
  {
    id: "hr-manager",
    roleTitle: "HR Manager",
    description: "Manages talent acquisition, development, and employee relations",
    jobDescription: `Role: HR Manager

Responsibilities:
- Lead recruitment processes from job posting to offer acceptance
- Manage employee onboarding, development, and performance review cycles
- Develop and implement HR policies and procedures
- Oversee payroll coordination and benefits administration
- Handle employee relations, conflict resolution, and disciplinary matters
- Ensure compliance with employment legislation
- Foster a positive workplace culture and employee engagement

Key Performance Indicators:
- Time to hire
- Employee retention rate
- Employee satisfaction scores
- Training completion rate

Skills Required:
- Degree in Human Resources or related field
- CIPD qualification preferred
- Knowledge of employment law
- Strong interpersonal and conflict resolution skills`,
  },
];

function sendSSE(res: import("express").Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get("/templates", (_req, res) => {
  res.json(TEMPLATES);
});

router.get("/jd-templates", (_req, res) => {
  res.json(JD_TEMPLATES);
});

router.post("/generate-jd", async (req, res, next) => {
  try {
    const { roleTitle, context } = req.body;
    if (!roleTitle) {
      res.status(400).json({ error: "roleTitle is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const systemPrompt = `You are an expert HR consultant and business writer. Generate a comprehensive, professional Job Description (JD) for the role provided. Structure it with clear sections: Role Overview, Key Responsibilities (bullet points), Key Performance Indicators, and Skills Required. Be specific, actionable, and professional. Write in second/third person. Do not use markdown headers with #, use plain text headers instead.`;

    const userMessage = `Write a full Job Description for the role: "${roleTitle}"${context ? `\n\nAdditional context: ${context}` : ""}`;

    const stream = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        fullText += token;
        sendSSE(res, "token", { token });
      }
    }

    sendSSE(res, "done", { text: fullText });
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post("/parse-jd", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      res.status(400).json({ error: "Only PDF, DOCX, and TXT files are supported" });
      return;
    }

    let rawText = "";
    if (file.mimetype === "text/plain") {
      rawText = file.buffer.toString("utf-8");
    } else if (file.mimetype === "application/pdf") {
      try {
        rawText = await extractPDFText(file.buffer);
      } catch (parseErr) {
        res.status(422).json({ error: "Could not extract text from this PDF. Please ensure it contains selectable (non-scanned) text, or use a TXT or DOCX file instead." });
        return;
      }
      if (!rawText.trim()) {
        res.status(422).json({ error: "No readable text found in this PDF. Please ensure it contains selectable text (not a scanned image), or use a TXT or DOCX file instead." });
        return;
      }
    } else if (
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.mimetype === "application/msword"
    ) {
      try {
        const docResult = await mammoth.extractRawText({ buffer: file.buffer });
        rawText = docResult.value;
      } catch (parseErr) {
        res.status(422).json({ error: "Could not extract text from DOCX file. Please check the file is a valid Word document." });
        return;
      }
    }

    if (!rawText.trim()) {
      res.status(422).json({ error: "No readable text could be extracted from the uploaded file. Please ensure the document contains selectable text." });
      return;
    }

    const completion = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at extracting and summarising Job Descriptions from documents. Given extracted document text, clean it up and format it as a professional Job Description with clear sections: Role Overview, Key Responsibilities, Key Performance Indicators, and Skills Required. Preserve all original content but improve formatting and structure. Do not invent information that is not present in the source text.",
        },
        {
          role: "user",
          content: `Extract and format the Job Description from this document content:\n\nFilename: ${file.originalname}\n\nContent:\n${rawText.slice(0, 8000)}`,
        },
      ],
    });

    const jobDescription = completion.choices[0]?.message?.content ?? "";
    res.json({ jobDescription });
  } catch (err) {
    next(err);
  }
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
    const { businessId, name, description, systemPrompt, jobDescription, toolAccess = [] } = req.body;

    if (!businessId || !name) {
      res.status(400).json({ error: "businessId and name are required" });
      return;
    }

    let resolvedSystemPrompt = systemPrompt;
    if (!resolvedSystemPrompt && jobDescription) {
      resolvedSystemPrompt = `You are an AI agent for this role. Here is your Job Description:\n\n${jobDescription}\n\nAct according to your role, responsibilities, and KPIs as described above.`;
    }

    if (!resolvedSystemPrompt) {
      res.status(400).json({ error: "Either systemPrompt or jobDescription is required" });
      return;
    }

    const id = generateToken(16);
    await db.insert(agentsTable).values({
      id,
      userId: req.userId!,
      businessId,
      name,
      description,
      systemPrompt: resolvedSystemPrompt,
      jobDescription: jobDescription ?? null,
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

    const allowed = ["name", "description", "systemPrompt", "jobDescription", "isActive", "scheduleType", "scheduleTime", "scheduleDay", "scheduleInterval", "toolAccess"];
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

    const costPence = getEventCost("agent_run");
    const debitResult = await checkWalletAndDebit(
      req.userId!,
      "agent_run",
      "Agent run",
      { agentId: agent.id, agentName: agent.name },
    );
    if (!debitResult.allowed) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        costPence,
        message: "Top up your wallet to continue using GoRigo AI.",
      });
      return;
    }

    const businessId = req.body.businessId ?? agent.businessId;
    const summary = `Agent "${agent.name}" ran successfully and analysed business data.`;
    await db.insert(agentLogsTable).values({
      id: generateToken(16),
      agentId: agent.id,
      userId: req.userId!,
      businessId,
      summary,
      actions: [],
    });

    await db.update(agentsTable).set({ lastRunAt: new Date() }).where(eq(agentsTable.id, agent.id));
    await recordUsage(req.userId!, businessId, "agent_run");

    res.json({ summary, actions: [], isPreview: false, walletBalancePence: debitResult.balancePence });
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
    jobDescription: a.jobDescription ?? null,
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
