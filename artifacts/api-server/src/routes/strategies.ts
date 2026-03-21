import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { strategiesTable, userProfilesTable, businessesTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { checkUsageLimit, recordUsage } from "../lib/usage.js";
import { getDecryptedKey } from "./keys.js";
import { generateToken } from "../lib/crypto.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";

const router = Router();
router.use(requireAuth);

const FRAMEWORKS: Record<string, { name: string; sections: string[] }> = {
  swot: {
    name: "SWOT Analysis",
    sections: ["Strengths", "Weaknesses", "Opportunities", "Threats", "Strategic Recommendations"],
  },
  porters_five_forces: {
    name: "Porter's Five Forces",
    sections: [
      "Threat of New Entrants",
      "Bargaining Power of Suppliers",
      "Bargaining Power of Buyers",
      "Threat of Substitutes",
      "Competitive Rivalry",
      "Strategic Implications",
    ],
  },
  okrs: {
    name: "OKRs",
    sections: [
      "Mission & Vision",
      "Objective 1",
      "Objective 2",
      "Objective 3",
      "Key Results & Metrics",
      "Execution Timeline",
    ],
  },
  blue_ocean: {
    name: "Blue Ocean Strategy",
    sections: [
      "Current Red Ocean (Competition)",
      "Eliminate",
      "Reduce",
      "Raise",
      "Create",
      "Blue Ocean Opportunity",
    ],
  },
  business_model_canvas: {
    name: "Business Model Canvas",
    sections: [
      "Customer Segments",
      "Value Propositions",
      "Channels",
      "Customer Relationships",
      "Revenue Streams",
      "Key Resources",
      "Key Activities",
      "Key Partnerships",
      "Cost Structure",
    ],
  },
  gtm_plan: {
    name: "Go-to-Market Plan",
    sections: [
      "Market Overview",
      "Target Audience",
      "Value Proposition",
      "Pricing & Positioning",
      "Distribution Channels",
      "Marketing & Messaging",
      "Launch Timeline",
      "Success Metrics",
    ],
  },
  competitive_landscape: {
    name: "Competitive Landscape",
    sections: [
      "Market Overview",
      "Key Competitors",
      "Competitive Advantages",
      "Market Gaps",
      "Positioning Strategy",
      "Action Plan",
    ],
  },
};

function sendSSE(res: import("express").Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get("/", async (req, res, next) => {
  try {
    const businessId = req.query["businessId"] as string | undefined;
    const framework = req.query["framework"] as string | undefined;

    if (!businessId) {
      res.status(400).json({ error: "businessId is required" });
      return;
    }

    const conditions = [
      eq(strategiesTable.businessId, businessId),
      eq(strategiesTable.userId, req.userId!),
    ];
    if (framework) {
      conditions.push(eq(strategiesTable.framework, framework));
    }

    const rows = await db
      .select()
      .from(strategiesTable)
      .where(and(...conditions))
      .orderBy(desc(strategiesTable.createdAt));

    res.json(rows.map((r) => ({
      id: r.id,
      framework: r.framework,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/generate", async (req, res, next) => {
  try {
    const parsed = z.object({
      businessId: z.string(),
      framework: z.string(),
    }).safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { businessId, framework } = parsed.data;

    if (!FRAMEWORKS[framework]) {
      res.status(400).json({ error: "Unknown framework" });
      return;
    }

    const { allowed, eventsUsed, eventsLimit } = await checkUsageLimit(req.userId!);
    if (!allowed) {
      res.status(429).json({ error: "usage_limit", upgrade: true, eventsUsed, eventsLimit });
      return;
    }

    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.userId!));

    const [business] = await db
      .select()
      .from(businessesTable)
      .where(and(eq(businessesTable.id, businessId), eq(businessesTable.userId, req.userId!)));

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const fw = FRAMEWORKS[framework]!;
    const sections = fw.sections.join(", ");

    const profileContext = [
      profile?.displayName ? `User: ${profile.displayName}` : null,
      business.name ? `Business: ${business.name}` : null,
      business.sector ? `Sector: ${business.sector}` : null,
      business.country ? `Country: ${business.country}` : null,
      business.accountType ? `Account Type: ${business.accountType}` : profile?.accountType ? `Account Type: ${profile.accountType}` : null,
      business.intent ? `Goals/Intent: ${business.intent}` : profile?.intent ? `Goals/Intent: ${profile.intent}` : null,
      business.background ? `Business Background: ${business.background}` : profile?.background ? `Business Background: ${profile.background}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are GoRigo, an expert AI business strategist. You produce deep, personalised strategic analyses using proven business frameworks.

${profileContext ? `USER CONTEXT:\n${profileContext}\n` : ""}

You will produce a ${fw.name} analysis. Structure your response with clear headings for each section: ${sections}.

Be specific, actionable, and tailored to the user's actual business context. Use concrete examples and practical recommendations. Format with ## headers for each section.`;

    const userPrompt = `Generate a comprehensive ${fw.name} analysis for my business. Use all the context you have about my business to make this as specific and actionable as possible.`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullResponse = "";
    let aiError = false;

    const userApiKey = await getDecryptedKey(req.userId!, "openai");

    try {
      if (userApiKey) {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${userApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 3000,
            temperature: 0.7,
            stream: true,
          }),
        });

        if (!resp.ok) {
          throw new Error(`OpenAI error: ${await resp.text()}`);
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
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
                  fullResponse += token;
                  sendSSE(res, "token", { token });
                }
              } catch { }
            }
          }
        }
      } else {
        const stream = await replitOpenAI.chat.completions.create({
          model: "gpt-5.2",
          max_completion_tokens: 3000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content ?? "";
          if (token) {
            fullResponse += token;
            sendSSE(res, "token", { token });
          }
        }
      }
    } catch (aiErr) {
      aiError = true;
      sendSSE(res, "error", { message: "I'm having trouble generating a response right now. Please try again in a moment." });
    }

    let savedId: string | null = null;
    if (!aiError && fullResponse.trim()) {
      savedId = generateToken(16);
      await db.insert(strategiesTable).values({
        id: savedId,
        businessId,
        userId: req.userId!,
        framework,
        prompt: userPrompt,
        content: fullResponse,
      });
      await recordUsage(req.userId!, businessId, "strategy_generate");
    }

    sendSSE(res, "done", { framework, savedId });
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
