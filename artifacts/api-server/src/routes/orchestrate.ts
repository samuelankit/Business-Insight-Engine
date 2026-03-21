import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { conversationsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { checkUsageLimit, recordUsage } from "../lib/usage.js";
import { getDecryptedKey } from "./keys.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();

const OrchestrateSchema = z.object({
  message: z.string().min(1).max(4000),
  businessId: z.string(),
  sessionMode: z.enum(["deep_research", "strategy_swot", "brainstorm", "business_plan"]).optional().nullable(),
  provider: z.enum(["openai", "anthropic"]).optional().nullable(),
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = OrchestrateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { message, businessId, provider = "openai" } = parsed.data;

    // Check usage limit
    const { allowed, eventsUsed, eventsLimit } = await checkUsageLimit(req.userId!);
    if (!allowed) {
      res.status(429).json({
        error: "usage_limit",
        upgrade: true,
        eventsUsed,
        eventsLimit,
      });
      return;
    }

    // Get user's API key
    const selectedProvider = provider ?? "openai";
    const apiKey = await getDecryptedKey(req.userId!, selectedProvider);

    // Store user message in conversation history
    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "user",
      content: message,
    });

    let response = "";

    if (apiKey) {
      try {
        if (selectedProvider === "openai") {
          response = await callOpenAI(apiKey, message, req.userId!, businessId);
        } else if (selectedProvider === "anthropic") {
          response = await callAnthropic(apiKey, message, req.userId!, businessId);
        }
      } catch (aiErr) {
        req.log.warn({ err: aiErr }, "AI call failed, using fallback");
        response = "I'm having trouble connecting to the AI service. Please check your API key in Settings.";
      }
    } else {
      response = `Hello! I'm GoRigo, your AI business assistant. To enable AI responses, please add your ${selectedProvider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings > API Keys.`;
    }

    // Store assistant response
    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "assistant",
      content: response,
    });

    // Record usage
    await recordUsage(req.userId!, businessId, "orchestrate");

    res.json({
      response,
      sessionMode: null,
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
    .where(
      and(
        eq(conversationsTable.userId, userId),
        eq(conversationsTable.businessId, businessId),
      ),
    )
    .orderBy(desc(conversationsTable.createdAt))
    .limit(20);

  return msgs.reverse().map((m) => ({ role: m.role, content: m.content }));
}

async function callOpenAI(apiKey: string, message: string, userId: string, businessId: string): Promise<string> {
  const history = await getConversationHistory(userId, businessId);
  const messages = [
    {
      role: "system",
      content: "You are GoRigo, an AI business operating system assistant for UK businesses. You help owners manage their business, automate tasks, and make decisions. Be concise, professional, and helpful.",
    },
    ...history.slice(-10), // last 10 messages for context window management
    { role: "user", content: message },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? "";
}

async function callAnthropic(apiKey: string, message: string, userId: string, businessId: string): Promise<string> {
  const history = await getConversationHistory(userId, businessId);
  const messages = history.slice(-10).concat([{ role: "user", content: message }]);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1000,
      system: "You are GoRigo, an AI business operating system assistant for UK businesses. You help owners manage their business, automate tasks, and make decisions. Be concise, professional, and helpful.",
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic error: ${err}`);
  }

  const data = await resp.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? "";
}

export default router;
