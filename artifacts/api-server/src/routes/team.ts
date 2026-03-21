import { Router } from "express";
import { db } from "@workspace/db";
import { teamMembersTable, teamInvitesTable, teamActivityTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

router.post("/invite", async (req, res, next) => {
  try {
    const { businessId, email, role = "viewer" } = req.body;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const code = generateToken(4).toUpperCase().slice(0, 8);
    // Fix: 7-day expiry (industry standard)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const id = generateToken(16);
    await db.insert(teamInvitesTable).values({
      id,
      code,
      businessId,
      role,
      email,
      invitedBy: req.userId!,
      expiresAt,
    });

    const [invite] = await db.select().from(teamInvitesTable).where(eq(teamInvitesTable.id, id));
    res.status(201).json(mapInvite(invite!));
  } catch (err) {
    next(err);
  }
});

router.post("/join", async (req, res, next) => {
  try {
    const { code, displayName } = req.body;
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }

    const [invite] = await db
      .select()
      .from(teamInvitesTable)
      .where(and(eq(teamInvitesTable.code, code), eq(teamInvitesTable.status, "pending")));

    if (!invite) {
      res.status(404).json({ error: "Invite not found or expired" });
      return;
    }

    if (invite.expiresAt < new Date()) {
      await db.update(teamInvitesTable).set({ status: "expired" }).where(eq(teamInvitesTable.id, invite.id));
      res.status(400).json({ error: "Invite has expired" });
      return;
    }

    const id = generateToken(16);
    await db.insert(teamMembersTable).values({
      id,
      userId: req.userId!,
      businessId: invite.businessId,
      role: invite.role,
      invitedBy: invite.invitedBy,
      displayName,
      status: "active",
    });

    await db.update(teamInvitesTable).set({ status: "accepted", acceptedBy: req.userId }).where(eq(teamInvitesTable.id, invite.id));

    const [member] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, id));
    res.json(mapMember(member!));
  } catch (err) {
    next(err);
  }
});

router.get("/members", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const members = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.businessId, businessId as string),
          eq(teamMembersTable.status, "active"),
        ),
      );

    res.json(members.map(mapMember));
  } catch (err) {
    next(err);
  }
});

router.patch("/members/:memberId", async (req, res, next) => {
  try {
    await db
      .update(teamMembersTable)
      .set({ role: req.body.role, updatedAt: new Date() })
      .where(eq(teamMembersTable.id, req.params.memberId!));

    const [member] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, req.params.memberId!));
    res.json(mapMember(member!));
  } catch (err) {
    next(err);
  }
});

router.delete("/members/:memberId", async (req, res, next) => {
  try {
    await db.update(teamMembersTable).set({ status: "removed" }).where(eq(teamMembersTable.id, req.params.memberId!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/invites", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const invites = await db
      .select()
      .from(teamInvitesTable)
      .where(
        and(
          eq(teamInvitesTable.businessId, businessId as string),
          eq(teamInvitesTable.status, "pending"),
        ),
      );

    res.json(invites.map(mapInvite));
  } catch (err) {
    next(err);
  }
});

router.delete("/invites/:inviteId", async (req, res, next) => {
  try {
    await db.update(teamInvitesTable).set({ status: "revoked" }).where(eq(teamInvitesTable.id, req.params.inviteId!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/activity", async (req, res, next) => {
  try {
    const { businessId, limit = "20" } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const activity = await db
      .select()
      .from(teamActivityTable)
      .where(eq(teamActivityTable.businessId, businessId as string))
      .orderBy(desc(teamActivityTable.createdAt))
      .limit(Number(limit));

    res.json(activity.map((a) => ({
      id: a.id,
      userId: a.userId,
      action: a.action,
      details: a.details ?? {},
      createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/role", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const [member] = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.userId, req.userId!),
          eq(teamMembersTable.businessId, businessId as string),
          eq(teamMembersTable.status, "active"),
        ),
      );

    res.json({ role: member?.role ?? null, isMember: !!member });
  } catch (err) {
    next(err);
  }
});

function mapMember(m: typeof teamMembersTable.$inferSelect) {
  return {
    id: m.id,
    userId: m.userId,
    businessId: m.businessId,
    role: m.role,
    displayName: m.displayName,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

function mapInvite(i: typeof teamInvitesTable.$inferSelect) {
  return {
    id: i.id,
    code: i.code,
    businessId: i.businessId,
    role: i.role,
    email: i.email,
    status: i.status,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export default router;
