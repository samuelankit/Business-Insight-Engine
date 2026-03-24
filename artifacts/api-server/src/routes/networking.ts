import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  networkProfilesTable,
  networkMatchesTable,
  networkConnectionsTable,
  networkQualificationLogsTable,
  networkFollowupsTable,
  businessesTable,
  usersTable,
  userSubscriptionsTable,
  usageEventsTable,
  pushTokensTable,
  agentsTable,
  agentPendingActionsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, gte, lte, count, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import { recordUsage, checkUsageLimit, getOrCreateSubscription, PLANS } from "../lib/usage.js";
import { sendNetworkingIntroEmail } from "../lib/email.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(requireAuth);

const OPPORTUNITY_TYPES = ["Partnership", "Client", "Talent", "Supplier", "Collaboration"] as const;
type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

const MAX_QUALIFICATION_TURNS = 5;
const MAX_QUALIFICATION_TOKENS = 2000;

async function isPaidUser(userId: string): Promise<boolean> {
  const sub = await getOrCreateSubscription(userId);
  const plan = PLANS.find((p) => p.id === sub.planId) ?? PLANS[0]!;
  return plan.id !== "free";
}

async function verifyBusinessOwnership(userId: string, businessId: string): Promise<boolean> {
  const [business] = await db
    .select({ id: businessesTable.id })
    .from(businessesTable)
    .where(and(eq(businessesTable.id, businessId), eq(businessesTable.userId, userId)))
    .limit(1);
  return !!business;
}

async function sendPushNotification(userId: string, title: string, body: string): Promise<void> {
  try {
    const tokens = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, userId));

    if (!tokens.length) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      sound: "default",
      title,
      body,
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to send push notification");
  }
}

async function generateBusinessEmbedding(business: typeof businessesTable.$inferSelect, profile: typeof networkProfilesTable.$inferSelect): Promise<number[] | null> {
  try {
    const text = [
      business.name,
      business.sector ?? "",
      business.background ?? "",
      business.intent ?? "",
      `Opportunity types: ${(profile.opportunityTypes as string[]).join(", ")}`,
      `Sector preferences: ${(profile.sectorPreferences as string[]).join(", ")}`,
      `Must-haves: ${profile.mustHaves ?? ""}`,
      `Deal-breakers: ${profile.dealBreakers ?? ""}`,
    ].filter(Boolean).join(". ");

    const resp = await replitOpenAI.embeddings.create({
      model: "text-embedding-ada-002",
      input: text.slice(0, 8000),
    });
    return resp.data[0]?.embedding ?? null;
  } catch (err) {
    logger.warn({ err }, "Failed to generate business embedding");
    return null;
  }
}

async function upsertBusinessEmbedding(businessId: string, embedding: number[]): Promise<void> {
  try {
    const vectorStr = `[${embedding.join(",")}]`;
    await db.execute(sql`UPDATE network_profiles SET embedding = ${vectorStr}::vector WHERE business_id = ${businessId}`);
  } catch (err) {
    logger.warn({ err }, "Failed to upsert business embedding");
  }
}

async function findSimilarByVector(businessId: string, limit: number = 20): Promise<string[]> {
  try {
    const result = await db.execute(sql`
      SELECT np2.business_id FROM network_profiles np1, network_profiles np2
      WHERE np1.business_id = ${businessId}
        AND np2.business_id != ${businessId}
        AND np1.embedding IS NOT NULL
        AND np2.embedding IS NOT NULL
        AND np2.is_opted_in = true
        AND np2.gdpr_consent_at IS NOT NULL
      ORDER BY np1.embedding <=> np2.embedding
      LIMIT ${limit}
    `);
    return (result.rows as Array<{ business_id: string }>).map((r) => r.business_id);
  } catch (err) {
    logger.warn({ err }, "pgvector similarity search failed, falling back to heuristic");
    return [];
  }
}

async function generateMatchReason(
  businessA: typeof businessesTable.$inferSelect,
  businessB: typeof businessesTable.$inferSelect,
  opportunityType: string,
): Promise<{ reason: string; score: number; inputTokens: number; outputTokens: number }> {
  try {
    const prompt = `You are Rigo, a business matchmaking AI. Analyse these two businesses and explain in 2-3 concise sentences why they would be a good ${opportunityType} match. Focus on complementary strengths, shared market opportunities, and mutual benefit.

Business A: ${businessA.name} (${businessA.sector ?? "General"}) — ${businessA.background ?? businessA.intent ?? ""}
Business B: ${businessB.name} (${businessB.sector ?? "General"}) — ${businessB.background ?? businessB.intent ?? ""}

Respond with JSON: {"reason": "...", "score": 75}
Score 0-100 based on alignment strength.`;

    const resp = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { reason?: string; score?: number };
    return {
      reason: parsed.reason ?? `Strong ${opportunityType.toLowerCase()} potential based on complementary business profiles.`,
      score: Math.min(100, Math.max(0, parsed.score ?? 70)),
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
    };
  } catch {
    return {
      reason: `Strong ${opportunityType.toLowerCase()} potential based on complementary business profiles.`,
      score: 70,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

async function generateQualificationQuestion(
  connectionId: string,
  turn: number,
  requesterBusiness: typeof businessesTable.$inferSelect,
  receiverBusiness: typeof businessesTable.$inferSelect,
  criteria: typeof networkProfilesTable.$inferSelect | null,
  previousTurns: Array<{ question: string; response: string | null }>,
): Promise<string> {
  const criteriaContext = criteria
    ? `Requester's criteria: must-haves: ${criteria.mustHaves ?? "none"}, deal-breakers: ${criteria.dealBreakers ?? "none"}, preferred sectors: ${(criteria.sectorPreferences as string[]).join(", ") || "any"}`
    : "";

  const previousContext = previousTurns
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.response ?? "(no response)"}`)
    .join("\n");

  const questions = [
    `What is your primary business goal for this ${requesterBusiness.sector ?? "business"} connection, and what timeline are you working towards?`,
    `Can you describe your current capacity for new partnerships — do you have the resources to commit to a meaningful collaboration in the next 3-6 months?`,
    `What specific value would you bring to ${requesterBusiness.name}, and what do you expect in return from this relationship?`,
    `Have you worked with similar businesses before? What worked well and what would you do differently?`,
    `What would make this connection a success from your perspective, and how would you measure it?`,
  ];

  const AI_DISCLOSURE_SUFFIX = `\n\n[This message was sent by Rigo AI, GoRigo's business qualification agent, on behalf of ${requesterBusiness.name}.]`;

  if (previousTurns.length === 0) {
    try {
      const prompt = `You are Rigo, an AI business qualification agent. ${requesterBusiness.name} wants to connect with ${receiverBusiness.name} for a business relationship. ${criteriaContext}

Ask turn ${turn} of ${MAX_QUALIFICATION_TURNS} qualification questions to assess if ${receiverBusiness.name} is a good fit. Ask ONE focused, conversational question. Be professional and direct. Do not explain what you are doing.`;

      const resp = await replitOpenAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
      });

      return (resp.choices[0]?.message?.content?.trim() ?? questions[0]!) + AI_DISCLOSURE_SUFFIX;
    } catch {
      return questions[0]! + AI_DISCLOSURE_SUFFIX;
    }
  }

  try {
    const prompt = `You are Rigo, an AI business qualification agent. You are qualifying ${receiverBusiness.name} as a potential connection for ${requesterBusiness.name}. ${criteriaContext}

Previous conversation:
${previousContext}

Ask turn ${turn} of ${MAX_QUALIFICATION_TURNS}. Ask ONE focused follow-up question based on the conversation so far. Be professional and direct.`;

    const resp = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });

    return (resp.choices[0]?.message?.content?.trim() ?? questions[Math.min(turn - 1, questions.length - 1)]!) + AI_DISCLOSURE_SUFFIX;
  } catch {
    return questions[Math.min(turn - 1, questions.length - 1)]! + AI_DISCLOSURE_SUFFIX;
  }
}

async function generateQualificationSummary(
  requesterBusiness: typeof businessesTable.$inferSelect,
  receiverBusiness: typeof businessesTable.$inferSelect,
  criteria: typeof networkProfilesTable.$inferSelect | null,
  turns: Array<{ question: string; response: string | null }>,
): Promise<{ summary: string; recommendation: string; inputTokens: number; outputTokens: number }> {
  try {
    const criteriaContext = criteria
      ? `Requester criteria — must-haves: ${criteria.mustHaves ?? "none"}, deal-breakers: ${criteria.dealBreakers ?? "none"}`
      : "";

    const transcript = turns
      .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.response ?? "(no response)"}`)
      .join("\n\n");

    const prompt = `You are Rigo. Summarise this qualification dialogue between your client (${requesterBusiness.name}) and a potential connection (${receiverBusiness.name}). ${criteriaContext}

Transcript:
${transcript}

Respond with JSON: {"summary": "2-3 sentence objective summary of the candidate's responses", "recommendation": "Recommend or Do not recommend connecting, with one key reason"}`;

    const resp = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { summary?: string; recommendation?: string };
    return {
      summary: parsed.summary ?? "Qualification complete. Candidate responded to all questions.",
      recommendation: parsed.recommendation ?? "Recommend connecting based on responses.",
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
    };
  } catch {
    return {
      summary: "Qualification complete. Candidate responded to all questions.",
      recommendation: "Recommend connecting based on responses.",
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

router.get("/status", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);

    const [profile] = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.userId, req.userId!),
          eq(networkProfilesTable.businessId, businessId as string),
        ),
      );

    res.json({
      isPaid: paid,
      isOptedIn: profile?.isOptedIn ?? false,
      hasGdprConsent: !!profile?.gdprConsentAt,
      hasCriteria: !!(profile?.mustHaves || profile?.dealBreakers || (profile?.sectorPreferences as string[])?.length),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/opt-in", async (req, res, next) => {
  try {
    const { businessId, opportunityTypes, sectorPreferences, dealBreakers, mustHaves } = req.body;

    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const types = (opportunityTypes as string[] | undefined) ?? [];
    const validTypes = types.filter((t) => OPPORTUNITY_TYPES.includes(t as OpportunityType));

    const now = new Date();
    const existing = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.userId, req.userId!),
          eq(networkProfilesTable.businessId, businessId as string),
        ),
      );

    const isPaid = await isPaidUser(req.userId!);
    if (existing.length) {
      await db
        .update(networkProfilesTable)
        .set({
          gdprConsentAt: now,
          isOptedIn: true,
          isPaidAccess: isPaid,
          opportunityTypes: validTypes,
          sectorPreferences: (sectorPreferences as string[] | undefined) ?? [],
          dealBreakers: dealBreakers ?? null,
          mustHaves: mustHaves ?? null,
          updatedAt: now,
        })
        .where(eq(networkProfilesTable.id, existing[0]!.id));
    } else {
      await db.insert(networkProfilesTable).values({
        id: generateToken(16),
        userId: req.userId!,
        businessId: businessId as string,
        gdprConsentAt: now,
        isOptedIn: true,
        isPaidAccess: isPaid,
        opportunityTypes: validTypes,
        sectorPreferences: (sectorPreferences as string[] | undefined) ?? [],
        dealBreakers: dealBreakers ?? null,
        mustHaves: mustHaves ?? null,
      });
    }

    const [updatedProfile] = await db
      .select()
      .from(networkProfilesTable)
      .where(eq(networkProfilesTable.businessId, businessId as string))
      .limit(1);

    const [myBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId as string))
      .limit(1);

    await db
      .delete(networkMatchesTable)
      .where(
        or(
          eq(networkMatchesTable.businessId, businessId as string),
          eq(networkMatchesTable.matchedBusinessId, businessId as string),
        ),
      );

    if (updatedProfile && myBusiness) {
      generateBusinessEmbedding(myBusiness, updatedProfile)
        .then((embedding) => {
          if (embedding) return upsertBusinessEmbedding(businessId as string, embedding);
        })
        .catch((err) => logger.warn({ err }, "Background embedding generation failed"));
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/matches", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const [profile] = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.userId, req.userId!),
          eq(networkProfilesTable.businessId, businessId as string),
        ),
      );

    if (!profile?.isOptedIn || !profile.gdprConsentAt) {
      res.status(403).json({ error: "GDPR consent required", needsOptIn: true });
      return;
    }

    const usageLimitCheck = await checkUsageLimit(req.userId!);
    if (!usageLimitCheck.allowed) {
      res.status(429).json({
        error: "Monthly AI event limit reached",
        eventsUsed: usageLimitCheck.eventsUsed,
        eventsLimit: usageLimitCheck.eventsLimit,
        upgrade: true,
      });
      return;
    }

    const expiryThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cachedMatches = await db
      .select()
      .from(networkMatchesTable)
      .where(
        and(
          eq(networkMatchesTable.userId, req.userId!),
          eq(networkMatchesTable.businessId, businessId as string),
          gte(networkMatchesTable.createdAt, expiryThreshold),
        ),
      )
      .orderBy(desc(networkMatchesTable.similarityScore))
      .limit(20);

    if (cachedMatches.length > 0) {
      const matchedBusinesses = await Promise.all(
        cachedMatches.map(async (m) => {
          const [biz] = await db
            .select()
            .from(businessesTable)
            .where(eq(businessesTable.id, m.matchedBusinessId));
          return { match: m, business: biz };
        }),
      );

      res.json(
        matchedBusinesses
          .filter((x) => x.business)
          .map(({ match, business }) => ({
            id: match.id,
            matchedBusinessId: match.matchedBusinessId,
            businessName: business!.name,
            sector: business!.sector ?? "General",
            matchReason: match.matchReason,
            matchStrength: match.similarityScore,
            opportunityType: match.opportunityType,
          })),
      );
      return;
    }

    const candidateBusinesses = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.isActive, true))
      .limit(50);

    const [myBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId as string));

    if (!myBusiness) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const eligibleProfiles = await db
      .select({ businessId: networkProfilesTable.businessId, userId: networkProfilesTable.userId })
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.isOptedIn, true),
          gte(networkProfilesTable.gdprConsentAt, new Date(0)),
        ),
      );

    const eligibleBusinessIds = new Set(eligibleProfiles.map((p) => p.businessId));

    const eligibleCandidates = candidateBusinesses.filter(
      (b) => b.id !== businessId && b.userId !== req.userId! && eligibleBusinessIds.has(b.id),
    );

    const paidCheckResults = await Promise.all(
      eligibleCandidates.map(async (b) => ({ id: b.id, isPaid: await isPaidUser(b.userId) })),
    );
    const paidBusinessIds = new Set(paidCheckResults.filter((r) => r.isPaid).map((r) => r.id));

    const candidates = eligibleCandidates.filter((b) => paidBusinessIds.has(b.id));

    const preferredTypes = profile.opportunityTypes as string[];
    const preferredSectors = profile.sectorPreferences as string[];

    const receiverProfileMap = new Map<string, typeof networkProfilesTable.$inferSelect>();
    for (const biz of candidates) {
      const [rp] = await db
        .select()
        .from(networkProfilesTable)
        .where(eq(networkProfilesTable.businessId, biz.id))
        .limit(1);
      if (rp) receiverProfileMap.set(biz.id, rp);
    }

    const eligibleWithProfiles = candidates.filter((b) => receiverProfileMap.has(b.id));

    const vectorPreFilterIds = await findSimilarByVector(businessId as string, 30);
    const vectorPreFilterSet = new Set(vectorPreFilterIds);

    const hasVectorResults = vectorPreFilterIds.length > 0;

    const prioritized = hasVectorResults
      ? [
          ...eligibleWithProfiles.filter((b) => vectorPreFilterSet.has(b.id)),
          ...eligibleWithProfiles.filter((b) => !vectorPreFilterSet.has(b.id)),
        ]
      : eligibleWithProfiles;

    const scored = prioritized
      .map((biz) => {
        const receiverProfile = receiverProfileMap.get(biz.id)!;
        const receiverTypes = receiverProfile.opportunityTypes as string[];
        const receiverSectors = receiverProfile.sectorPreferences as string[];

        const vectorBonus = hasVectorResults && vectorPreFilterSet.has(biz.id)
          ? Math.max(0, 20 - vectorPreFilterIds.indexOf(biz.id))
          : 0;

        const sharedTypes = preferredTypes.filter((t) => receiverTypes.includes(t));
        const typeBonus = sharedTypes.length > 0 ? Math.min(sharedTypes.length * 15, 30) : 5;

        let sectorScore = 0;
        if (preferredSectors.length > 0 && biz.sector && preferredSectors.includes(biz.sector)) sectorScore += 15;
        if (receiverSectors.length > 0 && myBusiness.sector && receiverSectors.includes(myBusiness.sector)) sectorScore += 15;
        if (myBusiness.sector && biz.sector && myBusiness.sector !== biz.sector) sectorScore += 5;

        const score = 40 + vectorBonus + typeBonus + sectorScore;
        const bestOpportunityType = sharedTypes[0] ?? preferredTypes[0] ?? "Partnership";

        return { biz, score: Math.min(score, 95), bestOpportunityType };
      });

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, 10);

    let totalMatchInputTokens = 0;
    let totalMatchOutputTokens = 0;
    const matchResults = await Promise.all(
      topCandidates.map(async ({ biz, score, bestOpportunityType }) => {
        const opportunityType = bestOpportunityType;

        const { reason, score: llmScore, inputTokens, outputTokens } = await generateMatchReason(myBusiness, biz, opportunityType);
        totalMatchInputTokens += inputTokens;
        totalMatchOutputTokens += outputTokens;
        const finalScore = Math.round((score + llmScore) / 2);

        const matchId = generateToken(16);
        await db.insert(networkMatchesTable).values({
          id: matchId,
          userId: req.userId!,
          businessId: businessId as string,
          matchedBusinessId: biz.id,
          matchedUserId: biz.userId,
          similarityScore: finalScore,
          matchReason: reason,
          opportunityType,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        return {
          id: matchId,
          matchedBusinessId: biz.id,
          businessName: biz.name,
          sector: biz.sector ?? "General",
          matchReason: reason,
          matchStrength: finalScore,
          opportunityType,
        };
      }),
    );

    await recordUsage(req.userId!, businessId as string, "network_match", {
      candidateCount: topCandidates.length,
      inputTokens: totalMatchInputTokens,
      outputTokens: totalMatchOutputTokens,
    });

    res.json(matchResults.filter(Boolean));
  } catch (err) {
    next(err);
  }
});

router.post("/connect", async (req, res, next) => {
  try {
    const { businessId, targetBusinessId, opportunityType, matchId } = req.body;

    if (!businessId || !targetBusinessId || !opportunityType) {
      res.status(400).json({ error: "businessId, targetBusinessId, and opportunityType required" });
      return;
    }

    if (!OPPORTUNITY_TYPES.includes(opportunityType as OpportunityType)) {
      res.status(400).json({ error: `opportunityType must be one of: ${OPPORTUNITY_TYPES.join(", ")}` });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const usageCheck = await checkUsageLimit(req.userId!);
    if (!usageCheck.allowed) {
      res.status(429).json({
        error: "Monthly AI event limit reached. Upgrade your plan to send more connection requests.",
        eventsUsed: usageCheck.eventsUsed,
        eventsLimit: usageCheck.eventsLimit,
        upgrade: true,
      });
      return;
    }

    const [requesterProfile] = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.userId, req.userId!),
          eq(networkProfilesTable.businessId, businessId as string),
        ),
      );

    if (!requesterProfile?.isOptedIn || !requesterProfile.gdprConsentAt) {
      res.status(403).json({ error: "GDPR consent required", needsOptIn: true });
      return;
    }

    const [targetBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, targetBusinessId as string));

    if (!targetBusiness) {
      res.status(404).json({ error: "Target business not found" });
      return;
    }

    const [receiverProfile] = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.businessId, targetBusinessId as string),
          eq(networkProfilesTable.isOptedIn, true),
        ),
      );

    if (!receiverProfile?.gdprConsentAt) {
      res.status(403).json({ error: "Target business has not consented to networking. Cannot initiate connection." });
      return;
    }

    const receiverIsPaid = await isPaidUser(targetBusiness.userId);
    if (!receiverIsPaid) {
      res.status(403).json({ error: "Target business does not have an active paid plan and cannot receive connection requests." });
      return;
    }

    const connectionId = generateToken(16);
    await db.insert(networkConnectionsTable).values({
      id: connectionId,
      requesterUserId: req.userId!,
      requesterBusinessId: businessId as string,
      receiverUserId: targetBusiness.userId,
      receiverBusinessId: targetBusinessId as string,
      status: "pending_qualification",
      opportunityType,
      matchId: matchId ?? null,
    });

    const [myBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId as string));

    const firstQuestion = await generateQualificationQuestion(
      connectionId,
      1,
      myBusiness!,
      targetBusiness,
      requesterProfile,
      [],
    );

    await db.insert(networkQualificationLogsTable).values({
      id: generateToken(16),
      connectionId,
      turn: 1,
      agentQuestion: firstQuestion,
      tokensCost: 50,
    });

    await recordUsage(req.userId!, businessId as string, "network_qualification_start", { connectionId });

    await sendPushNotification(
      targetBusiness.userId,
      "New Connection Request",
      `${myBusiness?.name ?? "A business"} wants to connect with you on GoRigo Network.`,
    );

    const MAX_TURNS = 5;
    const EST_TOKENS_PER_TURN = 400;
    const estimatedAiEvents = MAX_TURNS;
    const estimatedTokens = MAX_TURNS * EST_TOKENS_PER_TURN;

    res.status(201).json({
      connectionId,
      status: "pending_qualification",
      firstQuestion,
      costEstimate: {
        maxTurns: MAX_TURNS,
        estimatedAiEvents,
        estimatedTokens,
        note: `Up to ${MAX_TURNS} AI qualification turns (~${estimatedTokens} tokens) will be used for this connection.`,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/connections/:connectionId/qualification", async (req, res, next) => {
  try {
    const { connectionId } = req.params;

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const [connection] = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.id, connectionId!),
          or(
            eq(networkConnectionsTable.requesterUserId, req.userId!),
            eq(networkConnectionsTable.receiverUserId, req.userId!),
          ),
        ),
      );

    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const logs = await db
      .select()
      .from(networkQualificationLogsTable)
      .where(eq(networkQualificationLogsTable.connectionId, connectionId!))
      .orderBy(networkQualificationLogsTable.turn);

    res.json({
      connectionId,
      status: connection.status,
      isReceiver: connection.receiverUserId === req.userId!,
      turns: logs.map((l) => ({
        id: l.id,
        turn: l.turn,
        question: l.agentQuestion,
        response: l.userResponse,
        isComplete: l.isComplete,
        agentRecommendation: l.agentRecommendation,
      })),
      qualificationSummary: connection.qualificationSummary,
      agentRecommendation: connection.agentRecommendation,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:connectionId/qualify", async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const { response } = req.body;

    if (!response) {
      res.status(400).json({ error: "response required" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const [connection] = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.id, connectionId!),
          eq(networkConnectionsTable.receiverUserId, req.userId!),
          eq(networkConnectionsTable.status, "pending_qualification"),
        ),
      );

    if (!connection) {
      res.status(404).json({ error: "Connection not found or not in qualification status" });
      return;
    }

    const logs = await db
      .select()
      .from(networkQualificationLogsTable)
      .where(eq(networkQualificationLogsTable.connectionId, connectionId!))
      .orderBy(networkQualificationLogsTable.turn);

    const currentLog = logs.find((l) => !l.userResponse && !l.isComplete);
    if (!currentLog) {
      res.status(400).json({ error: "No pending question to respond to" });
      return;
    }

    const previousTokensExcludingCurrent = logs
      .filter((l) => l.id !== currentLog.id)
      .reduce((sum, l) => sum + (l.tokensCost ?? 0), 0);
    const responseTokenEstimate = Math.ceil(response.length / 4);
    const updatedTokenCost = (currentLog.tokensCost ?? 0) + responseTokenEstimate;

    await db
      .update(networkQualificationLogsTable)
      .set({ userResponse: response, tokensCost: updatedTokenCost })
      .where(eq(networkQualificationLogsTable.id, currentLog.id));

    const completedTurns = [...logs.filter((l) => l.userResponse), { ...currentLog, userResponse: response }];
    const accumulatedTokens = previousTokensExcludingCurrent + updatedTokenCost;
    const tokenCapReached = accumulatedTokens >= MAX_QUALIFICATION_TOKENS;

    if (completedTurns.length >= MAX_QUALIFICATION_TURNS || tokenCapReached) {
      const [requesterBusiness] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, connection.requesterBusinessId));

      const [receiverBusiness] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, connection.receiverBusinessId));

      const [criteria] = await db
        .select()
        .from(networkProfilesTable)
        .where(eq(networkProfilesTable.businessId, connection.requesterBusinessId));

      const {
        summary,
        recommendation,
        inputTokens: summaryInputTokens,
        outputTokens: summaryOutputTokens,
      } = await generateQualificationSummary(
        requesterBusiness!,
        receiverBusiness!,
        criteria ?? null,
        completedTurns.map((l) => ({ question: l.agentQuestion, response: l.userResponse ?? null })),
      );

      await db
        .update(networkQualificationLogsTable)
        .set({ isComplete: true, agentRecommendation: recommendation })
        .where(eq(networkQualificationLogsTable.id, currentLog.id));

      await db
        .update(networkConnectionsTable)
        .set({
          status: "pending_decision",
          qualificationSummary: summary,
          agentRecommendation: recommendation,
          updatedAt: new Date(),
        })
        .where(eq(networkConnectionsTable.id, connectionId!));

      await recordUsage(connection.requesterUserId, connection.requesterBusinessId, "network_qualification_complete", {
        connectionId,
        turns: completedTurns.length,
        inputTokens: summaryInputTokens,
        outputTokens: summaryOutputTokens,
        totalQualificationTokens: accumulatedTokens,
      });

      await sendPushNotification(
        connection.requesterUserId,
        "Connection Qualified",
        `${receiverBusiness?.name ?? "A business"} has completed qualification. Review and decide.`,
      );

      await sendPushNotification(
        req.userId!,
        "Qualification Complete",
        "Your responses have been forwarded. The requester will review and make a decision.",
      );

      res.json({
        complete: true,
        summary,
        recommendation,
        status: "pending_decision",
      });
    } else {
      const nextTurn = completedTurns.length + 1;

      const [requesterBusiness] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, connection.requesterBusinessId));

      const [receiverBusiness] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, connection.receiverBusinessId));

      const [criteria] = await db
        .select()
        .from(networkProfilesTable)
        .where(eq(networkProfilesTable.businessId, connection.requesterBusinessId));

      const nextQuestion = await generateQualificationQuestion(
        connectionId!,
        nextTurn,
        requesterBusiness!,
        receiverBusiness!,
        criteria ?? null,
        completedTurns.map((l) => ({ question: l.agentQuestion, response: l.userResponse ?? null })),
      );

      await db.insert(networkQualificationLogsTable).values({
        id: generateToken(16),
        connectionId: connectionId!,
        turn: nextTurn,
        agentQuestion: nextQuestion,
        tokensCost: 50,
      });

      res.json({
        complete: false,
        nextQuestion,
        turnsRemaining: MAX_QUALIFICATION_TURNS - nextTurn,
        status: "pending_qualification",
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get("/pending", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const pending = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.requesterUserId, req.userId!),
          eq(networkConnectionsTable.requesterBusinessId, businessId as string),
          eq(networkConnectionsTable.status, "pending_decision"),
        ),
      )
      .orderBy(desc(networkConnectionsTable.updatedAt));

    const withDetails = await Promise.all(
      pending.map(async (conn) => {
        const [receiverBusiness] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, conn.receiverBusinessId));

        const logs = await db
          .select()
          .from(networkQualificationLogsTable)
          .where(eq(networkQualificationLogsTable.connectionId, conn.id))
          .orderBy(networkQualificationLogsTable.turn);

        let matchStrength = 70;
        if (conn.matchId) {
          const [match] = await db
            .select()
            .from(networkMatchesTable)
            .where(eq(networkMatchesTable.id, conn.matchId));
          if (match) matchStrength = match.similarityScore;
        }

        return {
          connectionId: conn.id,
          status: conn.status,
          opportunityType: conn.opportunityType,
          receiverBusinessName: receiverBusiness?.name ?? "Unknown Business",
          receiverSector: receiverBusiness?.sector ?? "General",
          qualificationSummary: conn.qualificationSummary,
          agentRecommendation: conn.agentRecommendation,
          matchStrength,
          qualificationTranscript: logs.map((l) => ({
            turn: l.turn,
            question: l.agentQuestion,
            response: l.userResponse,
          })),
          createdAt: conn.createdAt.toISOString(),
        };
      }),
    );

    res.json(withDetails);
  } catch (err) {
    next(err);
  }
});

router.get("/incoming", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const incoming = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.receiverUserId, req.userId!),
          eq(networkConnectionsTable.receiverBusinessId, businessId as string),
          eq(networkConnectionsTable.status, "pending_qualification"),
        ),
      )
      .orderBy(desc(networkConnectionsTable.updatedAt));

    const withDetails = await Promise.all(
      incoming.map(async (conn) => {
        const [requesterBusiness] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, conn.requesterBusinessId));

        const logs = await db
          .select()
          .from(networkQualificationLogsTable)
          .where(eq(networkQualificationLogsTable.connectionId, conn.id))
          .orderBy(networkQualificationLogsTable.turn);

        const pendingTurn = logs.find((l) => !l.userResponse && !l.isComplete);

        return {
          connectionId: conn.id,
          opportunityType: conn.opportunityType,
          requesterBusinessName: requesterBusiness?.name ?? "Unknown Business",
          requesterSector: requesterBusiness?.sector ?? "General",
          totalTurns: MAX_QUALIFICATION_TURNS,
          completedTurns: logs.filter((l) => !!l.userResponse).length,
          currentQuestion: pendingTurn?.agentQuestion ?? null,
          currentTurnId: pendingTurn?.id ?? null,
        };
      }),
    );

    res.json(withDetails);
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:connectionId/decide", async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const { decision, handoffMode } = req.body;

    if (!decision || !["accept", "decline"].includes(decision)) {
      res.status(400).json({ error: "decision must be 'accept' or 'decline'" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const mode = decision === "accept" ? (handoffMode ?? "direct") : null;

    if (decision === "accept" && mode === "rigo") {
      const rigoDraftUsageCheck = await checkUsageLimit(req.userId!);
      if (!rigoDraftUsageCheck.allowed) {
        res.status(429).json({
          error: "Monthly AI event limit reached — Rigo cannot draft the intro.",
          eventsUsed: rigoDraftUsageCheck.eventsUsed,
          eventsLimit: rigoDraftUsageCheck.eventsLimit,
          upgrade: true,
        });
        return;
      }
    }

    const [connection] = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.id, connectionId!),
          eq(networkConnectionsTable.requesterUserId, req.userId!),
          eq(networkConnectionsTable.status, "pending_decision"),
        ),
      );

    if (!connection) {
      res.status(404).json({ error: "Connection not found or not pending decision" });
      return;
    }

    const [receiverBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.receiverBusinessId));

    const [requesterBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.requesterBusinessId));

    if (decision === "accept") {
      if (mode === "rigo") {
        let draftIntro: string;
        let draftTokensInput = 0;
        let draftTokensOutput = 0;
        try {
          const [criteria] = await db
            .select()
            .from(networkProfilesTable)
            .where(eq(networkProfilesTable.businessId, connection.requesterBusinessId));

          const resp = await replitOpenAI.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are Rigo, a professional AI business assistant. Draft a warm, professional introduction email. Keep it concise (3-4 sentences). Do NOT include any subject line. Do NOT include a signature — it will be added separately.",
              },
              {
                role: "user",
                content: `Draft an intro message from ${requesterBusiness?.name ?? "my business"} to ${receiverBusiness?.name ?? "their business"}. Opportunity type: ${connection.opportunityType}. Requester must-haves: ${criteria?.mustHaves ?? "none"}.`,
              },
            ],
            max_tokens: 200,
          });
          draftTokensInput = resp.usage?.prompt_tokens ?? 0;
          draftTokensOutput = resp.usage?.completion_tokens ?? 0;
          const body = resp.choices[0]?.message?.content?.trim() ?? "";
          const AI_DISCLOSURE = `\n\n---\nThis message was drafted by Rigo AI on behalf of ${requesterBusiness?.name ?? "your business"}.`;
          draftIntro = body + AI_DISCLOSURE;
        } catch {
          const AI_DISCLOSURE = `\n\n---\nThis message was drafted by Rigo AI on behalf of ${requesterBusiness?.name ?? "your business"}.`;
          draftIntro = `Hi ${receiverBusiness?.name ?? "there"},\n\nI came across your business on GoRigo and think there could be a great ${connection.opportunityType} opportunity between us. I'd love to connect and explore further.\n\nLooking forward to hearing from you.${AI_DISCLOSURE}`;
        }

        const [receiverUser] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, connection.receiverUserId));

        const emailResult = await sendNetworkingIntroEmail(
          req.userId!,
          requesterBusiness?.name ?? "A business",
          receiverUser?.email,
          `Business Introduction: ${connection.opportunityType} Opportunity from ${requesterBusiness?.name ?? "GoRigo"}`,
          draftIntro,
        );

        const finalStatus = emailResult.sent ? "intro_sent" : "accepted";
        const introAt = new Date();

        await db
          .update(networkConnectionsTable)
          .set({ status: finalStatus, handoffMode: mode, updatedAt: introAt })
          .where(eq(networkConnectionsTable.id, connectionId!));

        await recordUsage(req.userId!, connection.requesterBusinessId, "network_connection_accept", { connectionId });
        await recordUsage(req.userId!, connection.requesterBusinessId, "network_intro_draft", {
          connectionId,
          handoffMode: "rigo",
          inputTokens: draftTokensInput,
          outputTokens: draftTokensOutput,
        });

        if (emailResult.sent) {
          await recordUsage(req.userId!, connection.requesterBusinessId, "network_intro_sent", {
            connectionId,
            handoffMode: "rigo",
            deliveryMethod: "gmail_oauth",
            autoSent: true,
          });
        }

        const followupDate = new Date(introAt.getTime() + 3 * 24 * 60 * 60 * 1000);
        await db.insert(networkFollowupsTable).values({
          id: generateToken(16),
          connectionId: connectionId!,
          userId: req.userId!,
          promptText: emailResult.sent
            ? `Rigo sent an intro to ${receiverBusiness?.name ?? "your connection"} on your behalf. Follow up in 3 days if you don't hear back.`
            : `Rigo drafted an intro to ${receiverBusiness?.name ?? "your connection"} but could not send automatically. Review and send manually from the Network tab.`,
          scheduledAt: followupDate,
          isDraft: !emailResult.sent,
          draftContent: emailResult.sent ? null : draftIntro,
        } as typeof networkFollowupsTable.$inferInsert);

        const [rigoAgent] = await db
          .select()
          .from(agentsTable)
          .where(
            and(
              eq(agentsTable.userId, req.userId!),
              eq(agentsTable.businessId, connection.requesterBusinessId),
              eq(agentsTable.isActive, true),
            ),
          )
          .limit(1);

        if (rigoAgent && !emailResult.sent) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);
          await db.insert(agentPendingActionsTable).values({
            id: generateToken(16),
            agentId: rigoAgent.id,
            userId: req.userId!,
            businessId: connection.requesterBusinessId,
            actionType: "network_intro_send",
            actionDescription: `Rigo could not auto-send introduction to ${receiverBusiness?.name ?? "your connection"} (${emailResult.reason ?? "Gmail not connected"}). Review and send manually.`,
            actionPayload: {
              connectionId: connectionId!,
              receiverBusinessName: receiverBusiness?.name,
              opportunityType: connection.opportunityType,
              draftContent: draftIntro,
              deliveryFailureReason: emailResult.reason,
            },
            toolName: "networking",
            functionName: "approve-send",
            status: "pending",
            expiresAt,
          });
        }

        await sendPushNotification(
          req.userId!,
          emailResult.sent ? "Rigo Sent Your Intro" : "Rigo Drafted Your Intro",
          emailResult.sent
            ? `Rigo sent an introduction to ${receiverBusiness?.name ?? "your new connection"} on your behalf.`
            : `Rigo drafted an intro to ${receiverBusiness?.name ?? "your connection"}. Send it manually from the Network tab.`,
        );

        await sendPushNotification(
          connection.receiverUserId,
          "New Business Introduction",
          emailResult.sent
            ? `${requesterBusiness?.name ?? "A business"} sent you an introduction email via GoRigo Network.`
            : `${requesterBusiness?.name ?? "A business"} accepted your connection on GoRigo Network.`,
        );

        res.json({
          success: true,
          status: finalStatus,
          handoffMode: mode,
          introSent: emailResult.sent,
          deliveryMethod: emailResult.method,
          message: emailResult.sent
            ? "Connection accepted. Rigo sent the intro email automatically."
            : `Connection accepted. ${emailResult.reason ?? "Rigo draft saved — send manually from Network tab."}`,
          costEstimate: {
            eventsUsed: [
              { type: "network_connection_accept", count: 1 },
              { type: "network_intro_draft", count: 1 },
              ...(emailResult.sent ? [{ type: "network_intro_sent", count: 1 }] : []),
            ],
            note: "Rigo charged 2–3 AI events for intro draft and send.",
          },
        });
        return;
      }

      await db
        .update(networkConnectionsTable)
        .set({ status: "accepted", handoffMode: mode, updatedAt: new Date() })
        .where(eq(networkConnectionsTable.id, connectionId!));

      await recordUsage(req.userId!, connection.requesterBusinessId, "network_connection_accept", { connectionId });

      await sendPushNotification(
        connection.receiverUserId,
        "Connection Accepted",
        `${requesterBusiness?.name ?? "A business"} has accepted your connection request on GoRigo Network.`,
      );

      res.json({ success: true, status: "accepted", handoffMode: mode });
    } else {
      await db
        .update(networkConnectionsTable)
        .set({ status: "declined", handoffMode: null, updatedAt: new Date() })
        .where(eq(networkConnectionsTable.id, connectionId!));

      await sendPushNotification(
        connection.receiverUserId,
        "Connection Update",
        `Your connection request to ${requesterBusiness?.name ?? "a business"} has been reviewed.`,
      );

      res.json({ success: true, status: "declined", handoffMode: null });
    }
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:connectionId/draft-intro", async (req, res, next) => {
  try {
    const { connectionId } = req.params;

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const usageCheck = await checkUsageLimit(req.userId!);
    if (!usageCheck.allowed) {
      res.status(429).json({
        error: "Monthly AI event limit reached. Upgrade your plan to draft more intro messages.",
        eventsUsed: usageCheck.eventsUsed,
        eventsLimit: usageCheck.eventsLimit,
        upgrade: true,
      });
      return;
    }

    const [connection] = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.id, connectionId!),
          eq(networkConnectionsTable.requesterUserId, req.userId!),
          or(eq(networkConnectionsTable.status, "accepted"), eq(networkConnectionsTable.status, "intro_sent")),
        ),
      );

    if (!connection) {
      res.status(404).json({ error: "Connection not found or not accepted" });
      return;
    }

    const [myBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.requesterBusinessId));

    const [theirBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.receiverBusinessId));

    const disclosureFooter = `\n\n---\nThis message was drafted by Rigo AI on behalf of ${myBusiness?.name ?? "your business"}.`;

    try {
      const resp = await replitOpenAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Draft a brief, professional introductory message from ${myBusiness?.name ?? "us"} to ${theirBusiness?.name ?? "them"} for a ${connection.opportunityType} opportunity. Keep it under 100 words, warm but professional, and mention the specific opportunity type. Do not include a subject line.`,
          },
        ],
        max_tokens: 200,
      });

      const draft = (resp.choices[0]?.message?.content ?? "I'd love to connect and explore how we might work together.") + disclosureFooter;
      await recordUsage(req.userId!, connection.requesterBusinessId, "network_intro_draft", {
        connectionId,
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      });
      res.json({
        draft,
        costEstimate: {
          eventsUsed: [{ type: "network_intro_draft", count: 1 }],
          note: "1 AI event used to draft this intro message.",
        },
      });
    } catch {
      const draft = `Hi,\n\nI came across your business on GoRigo and I think there's a great ${connection.opportunityType.toLowerCase()} opportunity for us to explore together. I'd love to have a quick conversation to see if there's a mutual fit.\n\nLooking forward to hearing from you.${disclosureFooter}`;
      res.json({ draft });
    }
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:connectionId/approve-send", async (req, res, next) => {
  try {
    const { connectionId } = req.params;

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const [connection] = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          eq(networkConnectionsTable.id, connectionId!),
          eq(networkConnectionsTable.requesterUserId, req.userId!),
          eq(networkConnectionsTable.status, "accepted"),
          eq(networkConnectionsTable.handoffMode, "rigo"),
        ),
      );

    if (!connection) {
      res.status(404).json({ error: "Connection not found or not in Rigo handoff mode" });
      return;
    }

    const [draftFollowup] = await db
      .select()
      .from(networkFollowupsTable)
      .where(
        and(
          eq(networkFollowupsTable.connectionId, connectionId!),
          eq(networkFollowupsTable.userId, req.userId!),
          eq(networkFollowupsTable.isDraft, true),
        ),
      )
      .limit(1);

    if (!draftFollowup) {
      res.status(404).json({ error: "No pending draft found for this connection" });
      return;
    }

    const [receiverBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.receiverBusinessId));

    const [requesterBusiness] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, connection.requesterBusinessId));

    const [receiverUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, connection.receiverUserId));

    const emailResult = await sendNetworkingIntroEmail(
      req.userId!,
      requesterBusiness?.name ?? "A business",
      receiverUser?.email,
      `Business Introduction: ${connection.opportunityType} Opportunity from ${requesterBusiness?.name ?? "GoRigo"}`,
      draftFollowup.draftContent ?? `Hi,\n\nI'd love to connect and explore a ${connection.opportunityType} opportunity together.\n\nBest regards,\n${requesterBusiness?.name ?? "GoRigo User"}`,
    );

    const sentAt = new Date();
    const newStatus = emailResult.sent ? "intro_sent" : "accepted";

    await db
      .update(networkFollowupsTable)
      .set({ completedAt: emailResult.sent ? sentAt : null })
      .where(eq(networkFollowupsTable.id, draftFollowup.id));

    await db
      .update(networkConnectionsTable)
      .set({ status: newStatus, updatedAt: sentAt })
      .where(eq(networkConnectionsTable.id, connectionId!));

    await recordUsage(req.userId!, connection.requesterBusinessId, "network_intro_sent", {
      connectionId,
      handoffMode: "rigo",
      deliveryMethod: emailResult.method,
      deliverySuccess: emailResult.sent,
    });

    await sendPushNotification(
      connection.receiverUserId,
      "New Business Introduction",
      emailResult.sent
        ? `${requesterBusiness?.name ?? "A business"} sent you an introduction email via GoRigo Network.`
        : `You have received a business introduction from GoRigo Network. Check your messages.`,
    );

    res.json({
      success: true,
      message: emailResult.sent
        ? "Introduction approved and sent via Gmail."
        : `Introduction approved. ${emailResult.reason ?? "Gmail not connected — delivery via push notification only."}`,
      draft: draftFollowup.draftContent,
      sentTo: receiverBusiness?.name ?? "your connection",
      deliveryMethod: emailResult.method,
      status: newStatus,
      aiDisclosure: "This message was drafted by Rigo AI and includes a mandatory disclosure footer.",
      costEstimate: {
        eventsUsed: [{ type: "network_intro_sent", count: 1 }],
        note: "1 AI event used to send this introduction.",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/my-network", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const paid = await isPaidUser(req.userId!);
    if (!paid) {
      res.status(403).json({ error: "Network tab requires a paid plan", upgrade: true });
      return;
    }

    const connections = await db
      .select()
      .from(networkConnectionsTable)
      .where(
        and(
          or(
            and(
              eq(networkConnectionsTable.requesterUserId, req.userId!),
              eq(networkConnectionsTable.requesterBusinessId, businessId as string),
            ),
            and(
              eq(networkConnectionsTable.receiverUserId, req.userId!),
              eq(networkConnectionsTable.receiverBusinessId, businessId as string),
            ),
          ),
          or(
            eq(networkConnectionsTable.status, "accepted"),
            eq(networkConnectionsTable.status, "intro_sent"),
          ),
        ),
      )
      .orderBy(desc(networkConnectionsTable.updatedAt));

    const withDetails = await Promise.all(
      connections.map(async (conn) => {
        const isRequester = conn.requesterUserId === req.userId!;
        const otherBusinessId = isRequester ? conn.receiverBusinessId : conn.requesterBusinessId;

        const [otherBusiness] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, otherBusinessId));

        const followups = await db
          .select()
          .from(networkFollowupsTable)
          .where(
            and(
              eq(networkFollowupsTable.connectionId, conn.id),
              eq(networkFollowupsTable.userId, req.userId!),
            ),
          )
          .orderBy(networkFollowupsTable.scheduledAt);

        const qualificationLogs = await db
          .select()
          .from(networkQualificationLogsTable)
          .where(eq(networkQualificationLogsTable.connectionId, conn.id))
          .orderBy(networkQualificationLogsTable.turn);

        return {
          connectionId: conn.id,
          otherBusinessName: otherBusiness?.name ?? "Unknown Business",
          otherSector: otherBusiness?.sector ?? "General",
          opportunityType: conn.opportunityType,
          handoffMode: conn.handoffMode,
          status: conn.status,
          agentRecommendation: conn.agentRecommendation,
          qualificationSummary: conn.qualificationSummary,
          isRequester,
          followups: followups.map((f) => ({
            id: f.id,
            promptText: f.promptText,
            scheduledAt: f.scheduledAt.toISOString(),
            completedAt: f.completedAt?.toISOString() ?? null,
            isDraft: f.isDraft,
          })),
          qualificationTranscript: qualificationLogs.map((l) => ({
            turn: l.turn,
            question: l.agentQuestion,
            response: l.userResponse,
            isComplete: l.isComplete,
          })),
          connectedAt: conn.updatedAt.toISOString(),
        };
      }),
    );

    res.json(withDetails);
  } catch (err) {
    next(err);
  }
});

router.get("/network-summary", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.json({ summary: null });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.json({ summary: null });
      return;
    }

    const [profile] = await db
      .select()
      .from(networkProfilesTable)
      .where(
        and(
          eq(networkProfilesTable.userId, req.userId!),
          eq(networkProfilesTable.businessId, businessId as string),
        ),
      );

    if (!profile?.isOptedIn) {
      res.json({ summary: null });
      return;
    }

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [newMatches, pendingDecisions, accepted] = await Promise.all([
      db
        .select({ cnt: count() })
        .from(networkMatchesTable)
        .where(
          and(
            eq(networkMatchesTable.userId, req.userId!),
            gte(networkMatchesTable.createdAt, yesterday),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(networkConnectionsTable)
        .where(
          and(
            eq(networkConnectionsTable.requesterUserId, req.userId!),
            eq(networkConnectionsTable.status, "pending_decision"),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(networkConnectionsTable)
        .where(
          and(
            or(
              eq(networkConnectionsTable.requesterUserId, req.userId!),
              eq(networkConnectionsTable.receiverUserId, req.userId!),
            ),
            eq(networkConnectionsTable.status, "accepted"),
          ),
        ),
    ]);

    const newMatchCount = Number(newMatches[0]?.cnt ?? 0);
    const pendingCount = Number(pendingDecisions[0]?.cnt ?? 0);
    const acceptedCount = Number(accepted[0]?.cnt ?? 0);

    let summary = null;
    if (newMatchCount > 0 || pendingCount > 0 || acceptedCount > 0) {
      const parts: string[] = [];
      if (newMatchCount > 0) parts.push(`${newMatchCount} new business match${newMatchCount > 1 ? "es" : ""}`);
      if (pendingCount > 0) parts.push(`${pendingCount} connection${pendingCount > 1 ? "s" : ""} awaiting your decision`);
      if (acceptedCount > 0) parts.push(`${acceptedCount} active connection${acceptedCount > 1 ? "s" : ""} in your network`);
      summary = parts.join(", ");
    }

    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get("/followups", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const followups = await db
      .select()
      .from(networkFollowupsTable)
      .where(eq(networkFollowupsTable.userId, req.userId!))
      .orderBy(desc(networkFollowupsTable.scheduledAt))
      .limit(50);

    res.json(
      followups.map((f) => ({
        id: f.id,
        connectionId: f.connectionId,
        promptText: f.promptText,
        scheduledAt: f.scheduledAt,
        completedAt: f.completedAt,
        isDraft: f.isDraft,
        hasDraftContent: !!f.draftContent,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/process-followups", async (req, res, next) => {
  try {
    const { businessId } = req.body;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Business not found or access denied" });
      return;
    }

    const now = new Date();
    const dueFollowups = await db
      .select()
      .from(networkFollowupsTable)
      .where(
        and(
          eq(networkFollowupsTable.userId, req.userId!),
          eq(networkFollowupsTable.isDraft, false),
          lte(networkFollowupsTable.scheduledAt, now),
        ),
      )
      .limit(10);

    const unprocessed = dueFollowups.filter((f) => !f.completedAt);

    let processed = 0;
    for (const followup of unprocessed) {
      const [connection] = await db
        .select()
        .from(networkConnectionsTable)
        .where(eq(networkConnectionsTable.id, followup.connectionId))
        .limit(1);

      await sendPushNotification(
        req.userId!,
        "GoRigo Networking Reminder",
        followup.promptText.substring(0, 100),
      );

      if (connection?.handoffMode === "rigo" && connection.status === "intro_sent") {
        const [requesterBusiness] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, connection.requesterBusinessId));

        const [receiverUser] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, connection.receiverUserId));

        const [receiverBusiness] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, connection.receiverBusinessId));

        const followupBody = `Hi ${receiverBusiness?.name ?? "there"},\n\nI wanted to follow up on the introduction I sent recently regarding a ${connection.opportunityType} opportunity between our businesses. I'd love to connect and explore further when you have a moment.\n\nLooking forward to hearing from you.\n\n---\nThis follow-up was sent by Rigo AI on behalf of ${requesterBusiness?.name ?? "your business"}.`;

        await sendNetworkingIntroEmail(
          req.userId!,
          requesterBusiness?.name ?? "A business",
          receiverUser?.email,
          `Follow-up: ${connection.opportunityType} Opportunity from ${requesterBusiness?.name ?? "GoRigo"}`,
          followupBody,
        );

        await sendPushNotification(
          connection.receiverUserId,
          "Follow-up from a business connection",
          `${requesterBusiness?.name ?? "A business"} followed up on your GoRigo introduction.`,
        );
      }

      await db
        .update(networkFollowupsTable)
        .set({ completedAt: now })
        .where(eq(networkFollowupsTable.id, followup.id));

      await recordUsage(req.userId!, businessId as string, "network_followup_trigger", {
        followupId: followup.id,
        connectionId: followup.connectionId,
        rigoAutoFollowup: connection?.handoffMode === "rigo",
      });

      processed++;
    }

    res.json({
      processed,
      total: unprocessed.length,
      costEstimate: {
        eventsUsed: [{ type: "network_followup_trigger", count: processed }],
        note: `${processed} AI event(s) used for follow-up outreach.`,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
