import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  conversationsTable,
  networkProfilesTable,
  networkMatchesTable,
  networkConnectionsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, gte, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { checkWalletAndDebit, getOrCreateWallet, recordUsage } from "../lib/usage.js";
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

async function getNetworkingContextSummary(userId: string, businessId: string): Promise<string | null> {
  try {
    const [profile] = await db
      .select()
      .from(networkProfilesTable)
      .where(and(eq(networkProfilesTable.userId, userId), eq(networkProfilesTable.businessId, businessId)));

    if (!profile?.isOptedIn) return null;

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [newMatches, pendingDecisions, accepted] = await Promise.all([
      db
        .select({ cnt: count() })
        .from(networkMatchesTable)
        .where(and(eq(networkMatchesTable.userId, userId), gte(networkMatchesTable.createdAt, yesterday))),
      db
        .select({ cnt: count() })
        .from(networkConnectionsTable)
        .where(and(eq(networkConnectionsTable.requesterUserId, userId), eq(networkConnectionsTable.status, "pending_decision"))),
      db
        .select({ cnt: count() })
        .from(networkConnectionsTable)
        .where(
          and(
            or(eq(networkConnectionsTable.requesterUserId, userId), eq(networkConnectionsTable.receiverUserId, userId)),
            eq(networkConnectionsTable.status, "accepted"),
          ),
        ),
    ]);

    const newMatchCount = Number(newMatches[0]?.cnt ?? 0);
    const pendingCount = Number(pendingDecisions[0]?.cnt ?? 0);
    const acceptedCount = Number(accepted[0]?.cnt ?? 0);

    if (newMatchCount === 0 && pendingCount === 0 && acceptedCount === 0) return null;

    const parts: string[] = [];
    if (newMatchCount > 0) parts.push(`${newMatchCount} new business match${newMatchCount > 1 ? "es" : ""} available in the Network tab`);
    if (pendingCount > 0) parts.push(`${pendingCount} connection${pendingCount > 1 ? "s" : ""} awaiting your decision in the Network tab`);
    if (acceptedCount > 0) parts.push(`${acceptedCount} active business connection${acceptedCount > 1 ? "s" : ""} in your network`);

    return `NETWORKING UPDATE: ${parts.join("; ")}.`;
  } catch {
    return null;
  }
}

function sendSSE(res: import("express").Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = OrchestrateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { message, businessId, sessionMode, provider = "openai" } = parsed.data;

    const wallet = await getOrCreateWallet(req.userId!);
    const costPence = 5;
    if (wallet.balancePence < costPence) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: wallet.balancePence,
        costPence,
        message: "Top up your wallet to continue using GoRigo AI.",
      });
      return;
    }

    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "user",
      content: message,
    });

    const basePrompt = sessionMode
      ? (MODE_SYSTEM_PROMPTS[sessionMode] ?? BASE_SYSTEM_PROMPT)
      : BASE_SYSTEM_PROMPT;

    const networkingSummary = await getNetworkingContextSummary(req.userId!, businessId);
    const systemPrompt = networkingSummary
      ? `${basePrompt}\n\n${networkingSummary} If relevant to the user's message or when helpful, proactively mention these networking updates and guide them to the Network tab.`
      : basePrompt;

    const history = await getConversationHistory(req.userId!, businessId);
    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-10),
      { role: "user" as const, content: message },
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullResponse = "";

    const userApiKey = await getDecryptedKey(req.userId!, provider ?? "openai");

    try {
      if (userApiKey) {
        if ((provider ?? "openai") === "openai") {
          fullResponse = await streamWithUserKey(userApiKey, chatMessages, res);
        } else {
          fullResponse = await streamAnthropic(userApiKey, message, req.userId!, businessId, systemPrompt, res);
        }
      } else {
        fullResponse = await streamReplitAI(chatMessages, res);
      }
    } catch (aiErr) {
      req.log.warn({ err: aiErr }, "AI call failed");
      fullResponse = "I'm having trouble generating a response right now. Please try again in a moment.";
      sendSSE(res, "token", { token: fullResponse });
    }

    await db.insert(conversationsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId,
      role: "assistant",
      content: fullResponse,
    });

    await recordUsage(req.userId!, businessId, "orchestrate");

    const { balancePence } = await checkWalletAndDebit(
      req.userId!,
      "orchestrate",
      "AI orchestration",
      { businessId },
    );

    sendSSE(res, "done", {
      sessionMode: sessionMode ?? null,
      sessionStep: null,
      sessionTotalSteps: null,
      toolsUsed: [],
      walletBalancePence: balancePence,
    });

    res.end();
  } catch (err) {
    next(err);
  }
});

router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const businessId = req.query["businessId"] as string | undefined;
    if (!businessId) {
      res.status(400).json({ error: "businessId is required" });
      return;
    }

    const msgs = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.userId, req.userId!), eq(conversationsTable.businessId, businessId)))
      .orderBy(desc(conversationsTable.createdAt))
      .limit(20);

    const history = msgs.reverse().map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt,
    }));

    res.json({ messages: history });
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

async function streamReplitAI(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  res: import("express").Response,
): Promise<string> {
  const stream = await replitOpenAI.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages,
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? "";
    if (token) {
      full += token;
      sendSSE(res, "token", { token });
    }
  }
  return full;
}

async function streamWithUserKey(
  apiKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  res: import("express").Response,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: 2000, temperature: 0.7, stream: true }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6)) as { choices: Array<{ delta: { content?: string } }> };
          const token = json.choices[0]?.delta?.content ?? "";
          if (token) {
            full += token;
            sendSSE(res, "token", { token });
          }
        } catch {
        }
      }
    }
  }
  return full;
}

async function streamAnthropic(
  apiKey: string,
  message: string,
  userId: string,
  businessId: string,
  systemPrompt: string,
  res: import("express").Response,
): Promise<string> {
  const history = await getConversationHistory(userId, businessId);
  const messages = history.slice(-10).concat([{ role: "user" as const, content: message }]);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic error: ${err}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6)) as {
          type: string;
          delta?: { type: string; text?: string };
        };
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && json.delta.text) {
          full += json.delta.text;
          sendSSE(res, "token", { token: json.delta.text });
        }
      } catch {
      }
    }
  }
  return full;
}

export default router;
