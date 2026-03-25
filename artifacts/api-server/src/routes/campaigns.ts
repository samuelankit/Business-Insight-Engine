import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignMessagesTable,
  contactListMembersTable,
  contactsTable,
  businessesTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import nodemailer from "nodemailer";

async function verifyBusinessOwnership(userId: string, businessId: string) {
  const [biz] = await db
    .select({ id: businessesTable.id })
    .from(businessesTable)
    .where(and(eq(businessesTable.id, businessId), eq(businessesTable.userId, userId)));
  return !!biz;
}

async function verifyCampaignOwnership(userId: string, campaignId: string) {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));
  if (!campaign) return null;
  const owns = await verifyBusinessOwnership(userId, campaign.businessId);
  if (!owns) return null;
  return campaign;
}

const router = Router();
router.use(requireAuth);

function getMailTransport() {
  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] || "587");
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const EMAIL_COST_PENCE = 1;

router.get("/", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }
    if (!(await verifyBusinessOwnership(req.userId!, businessId as string))) {
      res.status(403).json({ error: "Access denied" });
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
    const { businessId, name, type = "email", listId, subject, messageTemplate, budgetCapPence } = req.body;
    if (!businessId || !name) {
      res.status(400).json({ error: "businessId and name required" });
      return;
    }
    if (!(await verifyBusinessOwnership(req.userId!, businessId))) {
      res.status(403).json({ error: "Access denied" });
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
      subject,
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
    const campaign = await verifyCampaignOwnership(req.userId!, req.params.id!);
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
    const existing = await verifyCampaignOwnership(req.userId!, req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    await db.update(campaignsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(campaignsTable.id, req.params.id!));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    res.json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
});

const statusChange = (status: string) => async (req: any, res: any, next: any) => {
  try {
    const existing = await verifyCampaignOwnership(req.userId!, req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    await db.update(campaignsTable).set({ status, updatedAt: new Date() }).where(eq(campaignsTable.id, req.params.id!));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, req.params.id!));
    res.json(mapCampaign(campaign!));
  } catch (err) {
    next(err);
  }
};

router.post("/:id/schedule", async (req, res, next) => {
  try {
    const existing = await verifyCampaignOwnership(req.userId!, req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
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

router.post("/:id/send", async (req, res, next) => {
  try {
    const campaign = await verifyCampaignOwnership(req.userId!, req.params.id!);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      res.status(400).json({ error: `Campaign is ${campaign.status}, must be draft or scheduled to send` });
      return;
    }

    if (campaign.type !== "email") {
      res.status(400).json({ error: "Only email campaigns can be sent" });
      return;
    }

    if (!campaign.listId) {
      res.status(400).json({ error: "Campaign has no audience list" });
      return;
    }

    const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, campaign.businessId));
    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const fromEmail = business.fromEmail;
    if (!fromEmail) {
      res.status(400).json({ error: "No sender email configured. Set a Campaign Email in Settings." });
      return;
    }

    const transport = getMailTransport();
    if (!transport) {
      res.status(500).json({ error: "Email service not configured. SMTP settings are missing." });
      return;
    }

    const members = await db
      .select({ contactId: contactListMembersTable.contactId })
      .from(contactListMembersTable)
      .where(eq(contactListMembersTable.listId, campaign.listId));

    if (members.length === 0) {
      res.status(400).json({ error: "Audience list has no contacts" });
      return;
    }

    const contactIds = members.map((m) => m.contactId);
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          sql`${contactsTable.id} IN (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(contactsTable.consentGiven, true),
          eq(contactsTable.dncListed, false),
        ),
      );

    const eligibleContacts = contacts.filter((c) => c.email);

    if (eligibleContacts.length === 0) {
      res.status(400).json({ error: "No eligible contacts with email, consent, and not DNC-listed" });
      return;
    }

    const totalCost = eligibleContacts.length * EMAIL_COST_PENCE;
    const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, req.userId!));
    const balance = wallet?.balancePence ?? 0;

    if (balance < totalCost) {
      res.status(402).json({
        error: `Insufficient wallet balance. Need ${totalCost}p (${eligibleContacts.length} emails × ${EMAIL_COST_PENCE}p), have ${balance}p.`,
      });
      return;
    }

    await db.update(campaignsTable).set({ status: "running", updatedAt: new Date() }).where(eq(campaignsTable.id, campaign.id));

    let sentCount = 0;
    let failedCount = 0;

    for (const contact of eligibleContacts) {
      const msgId = generateToken(16);
      try {
        const htmlBody = campaign.messageTemplate || "";
        const unsubFooter = `<br/><hr style="margin-top:24px;border:none;border-top:1px solid #ccc"/><p style="font-size:11px;color:#999;">You received this email because you opted in to communications from ${business.name}. If you no longer wish to receive these emails, please reply with "unsubscribe" or contact us directly.</p>`;
        const textBody = htmlBody.replace(/<[^>]*>/g, "") + `\n\n---\nYou received this email because you opted in to communications from ${business.name}. To unsubscribe, reply with "unsubscribe".`;

        await transport.sendMail({
          from: `${business.name} <${fromEmail}>`,
          to: contact.email!,
          subject: campaign.subject || campaign.name,
          html: htmlBody + unsubFooter,
          text: textBody,
        });

        await db.insert(campaignMessagesTable).values({
          id: msgId,
          campaignId: campaign.id,
          contactId: contact.id,
          status: "sent",
          sentAt: new Date(),
          cost: EMAIL_COST_PENCE,
        });
        sentCount++;
      } catch {
        await db.insert(campaignMessagesTable).values({
          id: msgId,
          campaignId: campaign.id,
          contactId: contact.id,
          status: "failed",
          cost: 0,
        });
        failedCount++;
      }
    }

    const actualCost = sentCount * EMAIL_COST_PENCE;
    if (actualCost > 0) {
      await db
        .update(walletsTable)
        .set({
          balancePence: sql`${walletsTable.balancePence} - ${actualCost}`,
          updatedAt: new Date(),
        })
        .where(eq(walletsTable.userId, req.userId!));

      await db.insert(walletTransactionsTable).values({
        id: generateToken(16),
        userId: req.userId!,
        type: "debit",
        amountPence: actualCost,
        description: `Campaign "${campaign.name}" — ${sentCount} emails sent`,
      });
    }

    await db
      .update(campaignsTable)
      .set({
        sentCount: (campaign.sentCount ?? 0) + sentCount,
        failedCount: (campaign.failedCount ?? 0) + failedCount,
        deliveredCount: (campaign.deliveredCount ?? 0) + sentCount,
        budgetSpentPence: (campaign.budgetSpentPence ?? 0) + actualCost,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, campaign.id));

    const [updated] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaign.id));
    res.json({
      ...mapCampaign(updated!),
      sendResult: { sent: sentCount, failed: failedCount, totalContacts: eligibleContacts.length },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-sender", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Invalid email format" });
      return;
    }

    const transport = getMailTransport();
    if (!transport) {
      res.status(500).json({ error: "Email service not configured. SMTP settings are missing." });
      return;
    }

    try {
      await transport.verify();
      res.json({ verified: true, message: `SMTP connection verified. Emails will be sent from ${email}.` });
    } catch (err: any) {
      res.json({ verified: false, message: err?.message || "SMTP verification failed" });
    }
  } catch (err) {
    next(err);
  }
});

function mapCampaign(c: typeof campaignsTable.$inferSelect) {
  return {
    id: c.id,
    businessId: c.businessId,
    name: c.name,
    type: c.type,
    status: c.status,
    listId: c.listId,
    subject: c.subject,
    messageTemplate: c.messageTemplate,
    scheduledStart: c.scheduledStart?.toISOString() ?? null,
    budgetCapPence: c.budgetCapPence,
    budgetSpentPence: c.budgetSpentPence,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    failedCount: c.failedCount,
    repliedCount: c.repliedCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export default router;
