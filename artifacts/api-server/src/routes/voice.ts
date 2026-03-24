import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { voicePreferencesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import { checkWalletAndDebit, getEventCost } from "../lib/usage.js";

const router = Router();

// POST /tts
router.post("/", async (req, res, next) => {
  try {
    const { text, provider } = req.body;
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    // Return a stub TTS response — real implementation would call Google TTS
    res.status(200).json({ message: "TTS synthesis would happen here", text });
  } catch (err) {
    next(err);
  }
});

// GET /voice-preferences
router.get("/voice-preferences", requireAuth, async (req, res, next) => {
  try {
    const [pref] = await db
      .select()
      .from(voicePreferencesTable)
      .where(eq(voicePreferencesTable.userId, req.userId!));

    res.json({
      provider: pref?.provider ?? "google",
      voiceName: pref?.voiceName ?? null,
      speechRate: pref?.speechRate ? Number(pref.speechRate) : null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /voice-preferences
router.put("/voice-preferences", requireAuth, async (req, res, next) => {
  try {
    const { provider, voiceName, speechRate } = req.body;

    const [existing] = await db
      .select()
      .from(voicePreferencesTable)
      .where(eq(voicePreferencesTable.userId, req.userId!));

    if (existing) {
      await db
        .update(voicePreferencesTable)
        .set({ provider, voiceName, speechRate: String(speechRate ?? "1"), updatedAt: new Date() })
        .where(eq(voicePreferencesTable.userId, req.userId!));
    } else {
      await db.insert(voicePreferencesTable).values({
        id: generateToken(16),
        userId: req.userId!,
        provider: provider ?? "google",
        voiceName,
        speechRate: String(speechRate ?? "1"),
      });
    }

    res.json({ provider: provider ?? "google", voiceName: voiceName ?? null, speechRate: speechRate ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /transcribe
router.post("/transcribe", requireAuth, async (req, res, next) => {
  try {
    const costPence = getEventCost("transcribe");
    const debitResult = await checkWalletAndDebit(
      req.userId!,
      "transcribe",
      "Audio transcription",
    );
    if (!debitResult.allowed) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        costPence,
        message: "Top up your wallet to continue using GoRigo AI.",
      });
      return;
    }

    res.json({ transcript: "", confidence: null, walletBalancePence: debitResult.balancePence });
  } catch (err) {
    next(err);
  }
});

export default router;
