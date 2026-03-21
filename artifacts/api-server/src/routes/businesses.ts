import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  businessesTable,
  teamMembersTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  sector: z.string().optional(),
  country: z.string().default("GB"),
  isActive: z.boolean().optional(),
  accountType: z.string().optional().nullable(),
  intent: z.string().optional().nullable(),
  background: z.string().optional().nullable(),
});

const UpdateSchema = z.object({
  name: z.string().optional(),
  sector: z.string().optional().nullable(),
  country: z.string().optional(),
  isActive: z.boolean().optional(),
  accountType: z.string().optional().nullable(),
  intent: z.string().optional().nullable(),
  background: z.string().optional().nullable(),
});

router.get("/", async (req, res, next) => {
  try {
    const businesses = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.userId, req.userId!));
    res.json(businesses.map(mapBusiness));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { name, sector, country, isActive, accountType, intent, background } = parsed.data;

    // Check if this is the first business
    const existing = await db
      .select({ id: businessesTable.id })
      .from(businessesTable)
      .where(eq(businessesTable.userId, req.userId!));

    const shouldBeActive = existing.length === 0 || isActive === true;

    // If setting active, deactivate others
    if (shouldBeActive) {
      await db
        .update(businessesTable)
        .set({ isActive: false })
        .where(eq(businessesTable.userId, req.userId!));
    }

    const id = generateToken(16);
    await db.insert(businessesTable).values({
      id,
      userId: req.userId!,
      name,
      sector,
      country,
      isActive: shouldBeActive,
      accountType: accountType ?? null,
      intent: intent ?? null,
      background: background ?? null,
    });

    // Auto-add as owner
    await db.insert(teamMembersTable).values({
      id: generateToken(16),
      userId: req.userId!,
      businessId: id,
      role: "owner",
      status: "active",
    });

    const [biz] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, id));

    res.status(201).json(mapBusiness(biz!));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const biz = await getOwnedBusiness(req.userId!, req.params.id!);
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    if (parsed.data.isActive === true) {
      await db
        .update(businessesTable)
        .set({ isActive: false })
        .where(eq(businessesTable.userId, req.userId!));
    }

    await db
      .update(businessesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(businessesTable.id, req.params.id!));

    const [updated] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, req.params.id!));

    res.json(mapBusiness(updated!));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const biz = await getOwnedBusiness(req.userId!, req.params.id!);
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    await db.delete(businessesTable).where(eq(businessesTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/insights", async (req, res, next) => {
  try {
    const [biz] = await db
      .select()
      .from(businessesTable)
      .where(
        and(
          eq(businessesTable.id, req.params.id!),
          eq(businessesTable.userId, req.userId!),
        ),
      );

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const sector = biz.sector ?? "general";
    const insightMap: Record<string, { recommendations: string[]; automationOpportunities: string[] }> = {
      retail: {
        recommendations: ["Automate inventory alerts", "Set up customer follow-up sequences", "Schedule social media posts"],
        automationOpportunities: ["Order confirmation emails", "Low stock notifications", "Customer review requests"],
      },
      hospitality: {
        recommendations: ["Automate booking confirmations", "Set up review collection", "Schedule staff reminders"],
        automationOpportunities: ["Reservation follow-ups", "Feedback collection", "Staff scheduling alerts"],
      },
      professional_services: {
        recommendations: ["Automate invoice reminders", "Set up client onboarding flows", "Schedule check-in calls"],
        automationOpportunities: ["Payment follow-ups", "Contract renewals", "Meeting scheduling"],
      },
      general: {
        recommendations: ["Automate routine communications", "Set up AI agents for repetitive tasks", "Connect your tools"],
        automationOpportunities: ["Email follow-ups", "Appointment reminders", "Report generation"],
      },
    };

    const insights = insightMap[sector] ?? insightMap["general"]!;
    res.json({ sector, ...insights });
  } catch (err) {
    next(err);
  }
});

async function getOwnedBusiness(userId: string, businessId: string) {
  const [biz] = await db
    .select()
    .from(businessesTable)
    .where(
      and(
        eq(businessesTable.id, businessId),
        eq(businessesTable.userId, userId),
      ),
    );
  return biz;
}

function mapBusiness(b: typeof businessesTable.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    sector: b.sector,
    country: b.country,
    isActive: b.isActive,
    accountType: b.accountType,
    intent: b.intent,
    background: b.background,
    createdAt: b.createdAt.toISOString(),
  };
}

export default router;
