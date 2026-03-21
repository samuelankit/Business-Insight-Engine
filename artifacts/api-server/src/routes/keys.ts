import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { encrypt, decrypt, generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

const SaveKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "elevenlabs"]),
  key: z.string().min(10),
});

router.get("/", async (req, res, next) => {
  try {
    const keys = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, req.userId!));

    res.json(
      keys.map((k) => ({
        id: k.id,
        provider: k.provider,
        maskedKey: k.maskedKey,
        createdAt: k.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = SaveKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { provider, key } = parsed.data;
    const maskedKey = `${key.slice(0, 8)}...${key.slice(-4)}`;
    const { encryptedPayload, encryptedDek } = encrypt(key);

    // Upsert
    const [existing] = await db
      .select()
      .from(apiKeysTable)
      .where(
        and(
          eq(apiKeysTable.userId, req.userId!),
          eq(apiKeysTable.provider, provider),
        ),
      );

    if (existing) {
      await db
        .update(apiKeysTable)
        .set({ encryptedKey: encryptedPayload, encryptedDek, maskedKey, updatedAt: new Date() })
        .where(eq(apiKeysTable.id, existing.id));

      res.json({ id: existing.id, provider, maskedKey, createdAt: existing.createdAt.toISOString() });
    } else {
      const id = generateToken(16);
      await db.insert(apiKeysTable).values({
        id,
        userId: req.userId!,
        provider,
        encryptedKey: encryptedPayload,
        encryptedDek,
        maskedKey,
      });
      res.json({ id, provider, maskedKey, createdAt: new Date().toISOString() });
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db
      .delete(apiKeysTable)
      .where(
        and(
          eq(apiKeysTable.id, req.params.id!),
          eq(apiKeysTable.userId, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/** Internal: Get decrypted key for a user+provider */
export async function getDecryptedKey(
  userId: string,
  provider: string,
): Promise<string | null> {
  const [key] = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.provider, provider)),
    );

  if (!key) return null;
  return decrypt(key.encryptedKey, key.encryptedDek);
}

export default router;
