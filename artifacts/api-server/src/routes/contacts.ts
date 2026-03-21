import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { contactsTable, contactListsTable } from "@workspace/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

// E.164 phone validation (Fix: validated at contact creation)
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const ContactSchema = z.object({
  businessId: z.string(),
  name: z.string().min(1).max(200),
  phone: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || E164_REGEX.test(v), {
      message: "Phone must be in E.164 format (e.g. +447700900000)",
    }),
  email: z.string().email().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  consentGiven: z.boolean().optional().default(false),
  dncListed: z.boolean().optional().default(false),
});

// GET /contacts
router.get("/", async (req, res, next) => {
  try {
    const { businessId, limit = "50", offset = "0", search } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const conditions = [eq(contactsTable.businessId, businessId as string)];
    if (search) conditions.push(ilike(contactsTable.name, `%${search}%`));

    const [contacts, total] = await Promise.all([
      db
        .select()
        .from(contactsTable)
        .where(and(...conditions))
        .orderBy(desc(contactsTable.createdAt))
        .limit(Number(limit))
        .offset(Number(offset)),
      db
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      contacts: contacts.map(mapContact),
      total: total.length,
      offset: Number(offset),
      limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /contacts
router.post("/", async (req, res, next) => {
  try {
    const parsed = ContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { businessId, name, phone, email, tags, consentGiven, dncListed } = parsed.data;
    const id = generateToken(16);
    const now = new Date();

    await db.insert(contactsTable).values({
      id,
      businessId,
      userId: req.userId!,
      name,
      phone,
      email,
      tags,
      consentGiven: consentGiven ?? false,
      consentAt: consentGiven ? now : undefined,
      dncListed: dncListed ?? false,
    });

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
    res.status(201).json(mapContact(contact!));
  } catch (err) {
    next(err);
  }
});

// POST /contacts/import
router.post("/import", async (req, res, next) => {
  try {
    const { businessId, contacts: rawContacts } = req.body;
    if (!businessId || !Array.isArray(rawContacts)) {
      res.status(400).json({ error: "businessId and contacts array required" });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const now = new Date();

    for (const raw of rawContacts) {
      const parsed = ContactSchema.safeParse({ ...raw, businessId });
      if (!parsed.success) {
        skipped++;
        errors.push(`${raw.name ?? "unknown"}: ${JSON.stringify(parsed.error.flatten())}`);
        continue;
      }

      const { name, phone, email, tags, consentGiven, dncListed } = parsed.data;
      try {
        await db.insert(contactsTable).values({
          id: generateToken(16),
          businessId,
          userId: req.userId!,
          name,
          phone,
          email,
          tags,
          consentGiven: consentGiven ?? false,
          consentAt: consentGiven ? now : undefined,
          dncListed: dncListed ?? false,
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    res.json({ imported, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    next(err);
  }
});

// DELETE /contacts/:id
router.delete("/:id", async (req, res, next) => {
  try {
    await db.delete(contactsTable).where(eq(contactsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Contact lists
router.get("/list", async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const lists = await db
      .select()
      .from(contactListsTable)
      .where(eq(contactListsTable.businessId, businessId as string));

    res.json(lists.map(mapList));
  } catch (err) {
    next(err);
  }
});

router.post("/list", async (req, res, next) => {
  try {
    const { businessId, name } = req.body;
    if (!businessId || !name) {
      res.status(400).json({ error: "businessId and name required" });
      return;
    }

    const id = generateToken(16);
    await db.insert(contactListsTable).values({
      id,
      businessId,
      userId: req.userId!,
      name,
      contactCount: "0",
    });

    const [list] = await db.select().from(contactListsTable).where(eq(contactListsTable.id, id));
    res.status(201).json(mapList(list!));
  } catch (err) {
    next(err);
  }
});

function mapContact(c: typeof contactsTable.$inferSelect) {
  return {
    id: c.id,
    businessId: c.businessId,
    name: c.name,
    phone: c.phone,
    email: c.email,
    tags: (c.tags as string[]) ?? [],
    consentGiven: c.consentGiven,
    dncListed: c.dncListed,
    createdAt: c.createdAt.toISOString(),
  };
}

function mapList(l: typeof contactListsTable.$inferSelect) {
  return {
    id: l.id,
    businessId: l.businessId,
    name: l.name,
    contactCount: Number(l.contactCount),
    createdAt: l.createdAt.toISOString(),
  };
}

export default router;
