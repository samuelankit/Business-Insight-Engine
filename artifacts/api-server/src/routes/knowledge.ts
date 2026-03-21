import { Router } from "express";
import { db } from "@workspace/db";
import { knowledgeDocumentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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

    const docs = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.businessId, businessId as string));

    res.json(docs.map((d) => ({
      id: d.id,
      title: d.title,
      businessId: d.businessId,
      status: d.status,
      chunkCount: d.chunkCount,
      createdAt: d.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { businessId, title } = req.body;
    if (!businessId || !title) {
      res.status(400).json({ error: "businessId and title required" });
      return;
    }

    const id = generateToken(16);
    await db.insert(knowledgeDocumentsTable).values({
      id,
      businessId,
      title,
      status: "processing",
    });

    const [doc] = await db.select().from(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, id));
    res.status(201).json({
      id: doc!.id,
      title: doc!.title,
      businessId: doc!.businessId,
      status: doc!.status,
      chunkCount: doc!.chunkCount,
      createdAt: doc!.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
