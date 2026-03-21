import { Router } from "express";
import { db } from "@workspace/db";
import { userReferralCodesTable, referralsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

router.get("/code", async (req, res, next) => {
  try {
    let [ref] = await db
      .select()
      .from(userReferralCodesTable)
      .where(eq(userReferralCodesTable.userId, req.userId!));

    if (!ref) {
      const code = `GORIGO-${generateToken(3).toUpperCase()}`;
      await db.insert(userReferralCodesTable).values({ userId: req.userId!, referralCode: code });
      ref = { userId: req.userId!, referralCode: code, createdAt: new Date() };
    }

    res.json({ code: ref.referralCode });
  } catch (err) {
    next(err);
  }
});

router.post("/apply", async (req, res, next) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) {
      res.status(400).json({ error: "referralCode required" });
      return;
    }

    const [refCode] = await db
      .select()
      .from(userReferralCodesTable)
      .where(eq(userReferralCodesTable.referralCode, referralCode));

    if (!refCode || refCode.userId === req.userId) {
      res.status(400).json({ error: "Invalid referral code" });
      return;
    }

    await db.insert(referralsTable).values({
      id: generateToken(16),
      referrerUserId: refCode.userId,
      referredUserId: req.userId!,
      referralCode,
      status: "completed",
    });

    res.json({ success: true, message: "Referral applied successfully" });
  } catch (err) {
    next(err);
  }
});

router.get("/stats", async (req, res, next) => {
  try {
    let [ref] = await db
      .select()
      .from(userReferralCodesTable)
      .where(eq(userReferralCodesTable.userId, req.userId!));

    if (!ref) {
      const code = `GORIGO-${generateToken(3).toUpperCase()}`;
      await db.insert(userReferralCodesTable).values({ userId: req.userId!, referralCode: code });
      ref = { userId: req.userId!, referralCode: code, createdAt: new Date() };
    }

    const referrals = await db
      .select()
      .from(referralsTable)
      .where(eq(referralsTable.referrerUserId, req.userId!));

    const completed = referrals.filter((r) => r.status === "completed" || r.status === "rewarded");
    const rewarded = referrals.filter((r) => r.rewardApplied);

    res.json({
      code: ref.referralCode,
      totalReferrals: referrals.length,
      completedReferrals: completed.length,
      rewardsEarned: rewarded.length * 500, // 500 pence per referral reward
    });
  } catch (err) {
    next(err);
  }
});

export default router;
