import { Router } from "express";
import { db } from "@workspace/db";
import { knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import multer from "multer";
import mammoth from "mammoth";
import { extractPDFText } from "../lib/pdfExtract.js";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function chunkText(text: string, chunkSize = 500, overlapSize = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(" ");
    if (chunk.trim()) chunks.push(chunk.trim());
    if (end >= words.length) break;
    start = end - overlapSize;
  }

  return chunks;
}

async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await replitOpenAI.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8191),
    });
    return resp.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function processDocument(
  docId: string,
  businessId: string,
  text: string,
): Promise<void> {
  const chunks = chunkText(text, 500, 50);
  const insertedChunks: Array<{ id: string; documentId: string; businessId: string; content: string; embedding: string | null; chunkIndex: number }> = [];

  let embeddingFailures = 0;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]!;
    const embedding = await getEmbedding(content);
    if (!embedding) embeddingFailures++;
    insertedChunks.push({
      id: generateToken(16),
      documentId: docId,
      businessId,
      content,
      embedding: embedding ? JSON.stringify(embedding) : null,
      chunkIndex: i,
    });
  }

  if (insertedChunks.length > 0) {
    for (const chunk of insertedChunks) {
      await db.insert(knowledgeChunksTable).values(chunk);
      if (chunk.embedding) {
        try {
          await db.execute(sql`
            UPDATE knowledge_chunks
            SET embedding_vec = ${chunk.embedding}::vector
            WHERE id = ${chunk.id}
          `);
        } catch {
        }
      }
    }
  }

  const allFailed = embeddingFailures === insertedChunks.length && insertedChunks.length > 0;
  const status = allFailed ? "failed" : "ready";

  await db
    .update(knowledgeDocumentsTable)
    .set({ status, chunkCount: insertedChunks.length })
    .where(eq(knowledgeDocumentsTable.id, docId));
}

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
      agentId: d.agentId ?? null,
      status: d.status,
      chunkCount: d.chunkCount,
      createdAt: d.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    const { businessId, title, content: textContent } = req.body as { businessId?: string; title?: string; content?: string };
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
      agentId: doc!.agentId ?? null,
      status: doc!.status,
      chunkCount: doc!.chunkCount,
      createdAt: doc!.createdAt.toISOString(),
    });

    let extractedText = "";

    if (req.file) {
      const { mimetype, originalname, buffer } = req.file;
      const ext = (originalname ?? "").toLowerCase().split(".").pop();

      if (mimetype === "application/pdf" || ext === "pdf") {
        extractedText = await extractPDFText(buffer);
      } else if (
        mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        ext === "docx"
      ) {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else {
        extractedText = buffer.toString("utf-8");
      }
    } else if (textContent) {
      extractedText = textContent;
    }

    if (!extractedText.trim()) {
      await db
        .update(knowledgeDocumentsTable)
        .set({ status: "failed" })
        .where(eq(knowledgeDocumentsTable.id, id));
      return;
    }

    processDocument(id, businessId, extractedText).catch((err) => {
      console.error("processDocument error:", err);
      db.update(knowledgeDocumentsTable)
        .set({ status: "failed" })
        .where(eq(knowledgeDocumentsTable.id, id))
        .catch(() => {});
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { agentId } = req.body as { agentId?: string | null };
    await db
      .update(knowledgeDocumentsTable)
      .set({ agentId: agentId ?? null })
      .where(eq(knowledgeDocumentsTable.id, req.params.id!));

    const [doc] = await db.select().from(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, req.params.id!));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({
      id: doc.id,
      title: doc.title,
      businessId: doc.businessId,
      agentId: doc.agentId ?? null,
      status: doc.status,
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, req.params.id!));
    await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
