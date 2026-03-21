import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.businessId, businessId as string));
    res.json(campaigns.map(mapCampaign));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { businessId, name, type = "sms", listId, messageTemplate, budgetCapPence } = req.body;
    if (!businessId || !name) {
      res.status(400).json({ error: "businessId and name required" });
      return;
    }

    const id = generateToken(16);
    await db.insert(campaignsTable).values({
      id,
      businessId,
      userId: req.userId!,
      name,
      type,
      listId,
      messageTemplate,
      budgetCapPence,
    });

    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    res.status(201).json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(mapCampaign(campaign));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    await db.update(campaignsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(campaignsTable.id, req.params.id!));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    res.json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
});

const statusChange = (status: string) => async (req: any, res: any, next: any) => {
  try {
    await db.update(campaignsTable).set({ status, updatedAt: new Date() }).where(eq(campaignsTable.id, req.params.id!));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    res.json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
};

router.post("/:id/schedule", async (req, res, next) => {
  try {
    const { scheduledStart } = req.body;
    await db.update(campaignsTable).set({ status: "scheduled", scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined, updatedAt: new Date() }).where(eq(campaignsTable.id, req.params.id!));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    res.json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/pause", statusChange("paused"));
router.post("/:id/resume", statusChange("running"));
router.post("/:id/cancel", statusChange("cancelled"));

function mapCampaign(c: typeof campaignsTable.$inferSelect) {
  return {
    id: c.id,
    businessId: c.businessId,
    name: c.name,
    type: c.type,
    status: c.status,
    listId: c.listId,
    messageTemplate: c.messageTemplate,
    scheduledStart: c.scheduledStart?.toISOString() ?? null,
    budgetCapPence: c.budgetCapPence,
    budgetSpentPence: c.budgetSpentPence,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export default router;
