import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { conversationsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { checkUsageLimit, recordUsage } from "../lib/usage.js";
import { getDecryptedKey } from "./keys.js";
import { generateToken } from "../lib/crypto.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";

const router = Router();

const OrchestrateSchema = z.object({
  message: z.string().min(1).max(4000),
  businessId: z.string(),
  sessionMode: z.enum(["deep_research", "strategy_swot", "brainstorm", "business_plan"]).optional().nullable(),
  provider: z.enum(["openai", "anthropic"]).optional().nullable(),
});

const MODE_SYSTEM_PROMPTS: Record<string, string> = {
  deep_research:
    "You are GoRigo in Deep Research mode. Conduct thorough analysis of the user's business topic. Provide well-structured, evidence-based insights with specific recommendations. Use headings and bullet points for clarity.",
  strategy_swot:
    "You are GoRigo in Strategy SWOT mode. Analyse the user's business using the SWOT framework (Strengths, Weaknesses, Opportunities, Threats). Be specific, actionable, and tailored to UK business conditions.",
  brainstorm:
    "You are GoRigo in Brainstorm mode. Generate creative, diverse ideas rapidly without filtering. Encourage lateral thinking. Present ideas as a numbered list, then discuss the most promising ones.",
  business_plan:
    "You are GoRigo in Business Plan mode. Help the user build a structured business plan. Cover executive summary, market analysis, operations, financials, and growth strategy. Ask clarifying questions to tailor the plan.",
};

const BASE_SYSTEM_PROMPT =
  "You are GoRigo, an AI business operating system assistant for UK businesses. You help owners manage their business, automate tasks, and make data-driven decisions. Be concise, professional, and practical. Use British English.";

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = OrchestrateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { message, businessId, sessionMode, provider = "openai" } = parsed.data;

    const { allowed, eventsUsed, eventsLimit } = await checkUsageLimit(req.userId!);
    if (!allowed) {
      res.status(429).json({ error: "usage_limit", upgrade: true, eventsUsed, eventsLimit });
      return;
    }

    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "user",
      content: message,
    });

    const systemPrompt = sessionMode
      ? (MODE_SYSTEM_PROMPTS[sessionMode] ?? BASE_SYSTEM_PROMPT)
      : BASE_SYSTEM_PROMPT;

    const history = await getConversationHistory(req.userId!, businessId);
    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-10),
      { role: "user" as const, content: message },
    ];

    let response = "";

    const userApiKey = await getDecryptedKey(req.userId!, provider ?? "openai");

    try {
      if (userApiKey) {
        if ((provider ?? "openai") === "openai") {
          response = await callWithUserKey(userApiKey, chatMessages, "openai");
        } else {
          response = await callAnthropic(userApiKey, message, req.userId!, businessId, systemPrompt);
        }
      } else {
        response = await callReplitAI(chatMessages);
      }
    } catch (aiErr) {
      req.log.warn({ err: aiErr }, "AI call failed");
      response = "I'm having trouble generating a response right now. Please try again in a moment.";
    }

    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "assistant",
      content: response,
    });

    await recordUsage(req.userId!, businessId, "orchestrate");

    res.json({
      response,
      sessionMode: sessionMode ?? null,
      sessionStep: null,
      sessionTotalSteps: null,
      toolsUsed: [],
      usage: eventsUsed + 1,
    });
  } catch (err) {
    next(err);
  }
});

async function getConversationHistory(userId: string, businessId: string) {
  const msgs = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.userId, userId), eq(conversationsTable.businessId, businessId)))
    .orderBy(desc(conversationsTable.createdAt))
    .limit(20);

  return msgs.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

async function callReplitAI(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
  const completion = await replitOpenAI.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages,
  });
  return completion.choices[0]?.message.content ?? "";
}

async function callWithUserKey(
  apiKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  _provider: string,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: 2000, temperature: 0.7 }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? "";
}

async function callAnthropic(
  apiKey: string,
  message: string,
  userId: string,
  businessId: string,
  systemPrompt: string,
): Promise<string> {
  const history = await getConversationHistory(userId, businessId);
  const messages = history.slice(-10).concat([{ role: "user" as const, content: message }]);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", max_tokens: 2000, system: systemPrompt, messages }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic error: ${err}`);
  }

  const data = (await resp.json()) as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? "";
}

export default router;
