import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, userTokensTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

// DELETE /account — GDPR Article 17 right to erasure
router.delete("/", requireAuth, async (req, res, next) => {
  try {
    // Cascade-delete will handle all user data via FK constraints
    await db.delete(usersTable).where(eq(usersTable.id, req.userId!));
    res.json({ success: true, message: "Your account and all associated data have been permanently deleted." });
  } catch (err) {
    next(err);
  }
});

export default router;
