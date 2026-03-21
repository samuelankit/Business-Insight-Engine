import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { userProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

const UpdateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  email: z.string().email().optional().nullable(),
  country: z.string().max(10).optional().nullable(),
  accountType: z.enum(["individual", "company"]).optional().nullable(),
  intent: z.string().max(500).optional().nullable(),
  background: z.string().max(2000).optional().nullable(),
  tocAcceptedAt: z.string().optional().nullable(),
});

router.get("/", async (req, res, next) => {
  try {
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.userId!));

    if (!profile) {
      res.json({ userId: req.userId, displayName: null, email: null, country: null, accountType: null, intent: null, background: null, tocAcceptedAt: null });
      return;
    }

    res.json(mapProfile(profile));
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const data = parsed.data;

    const [existing] = await db
      .select({ id: userProfilesTable.id })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.userId!));

    if (existing) {
      await db
        .update(userProfilesTable)
        .set({
          ...(data.displayName !== undefined && { displayName: data.displayName }),
          ...(data.email !== undefined && { email: data.email }),
          ...(data.country !== undefined && { country: data.country }),
          ...(data.accountType !== undefined && { accountType: data.accountType }),
          ...(data.intent !== undefined && { intent: data.intent }),
          ...(data.background !== undefined && { background: data.background }),
          ...(data.tocAcceptedAt !== undefined && { tocAcceptedAt: data.tocAcceptedAt ? new Date(data.tocAcceptedAt) : null }),
          updatedAt: new Date(),
        })
        .where(eq(userProfilesTable.userId, req.userId!));
    } else {
      await db.insert(userProfilesTable).values({
        id: generateToken(16),
        userId: req.userId!,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        country: data.country ?? null,
        accountType: data.accountType ?? null,
        intent: data.intent ?? null,
        background: data.background ?? null,
        tocAcceptedAt: data.tocAcceptedAt ? new Date(data.tocAcceptedAt) : null,
      });
    }

    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, req.userId!));

    res.json(mapProfile(profile!));
  } catch (err) {
    next(err);
  }
});

function mapProfile(p: typeof userProfilesTable.$inferSelect) {
  return {
    userId: p.userId,
    displayName: p.displayName,
    email: p.email,
    country: p.country,
    accountType: p.accountType,
    intent: p.intent,
    background: p.background,
    tocAcceptedAt: p.tocAcceptedAt?.toISOString() ?? null,
  };
}

export default router;
