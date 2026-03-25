import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { contactsTable, contactListsTable, contactListMembersTable, contactNotesTable } from "@workspace/db/schema";
import { eq, and, ilike, desc, or, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import multer from "multer";

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

const PatchContactSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || E164_REGEX.test(v), {
      message: "Phone must be in E.164 format",
    }),
  email: z.string().email().optional().nullable(),
  tags: z.array(z.string()).optional(),
  consentGiven: z.boolean().optional(),
  dncListed: z.boolean().optional(),
});

// GET /contacts
router.get("/", async (req, res, next) => {
  try {
    const { businessId, limit = "50", offset = "0", search } = req.query;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [eq(contactsTable.businessId, businessId as string)];
    if (search) {
      conditions.push(
        or(
          ilike(contactsTable.name, `%${search}%`),
          ilike(contactsTable.email, `%${search}%`),
          ilike(contactsTable.phone, `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }

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

// --- STATIC/SPECIFIC ROUTES BEFORE /:id ---

// POST /contacts/import — supports both JSON and multipart CSV
router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    const businessId = req.body?.businessId;
    if (!businessId) {
      res.status(400).json({ error: "businessId required" });
      return;
    }

    let rawContacts: { name?: string; email?: string; phone?: string }[] = [];

    if (req.file) {
      const csvText = req.file.buffer.toString("utf-8");
      rawContacts = parseCSV(csvText);
    } else if (Array.isArray(req.body?.contacts)) {
      rawContacts = req.body.contacts;
    } else {
      res.status(400).json({ error: "contacts array or CSV file required" });
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

      // Skip duplicates by phone or email within the same business
      if (phone || email) {
        const dupConditions: ReturnType<typeof eq>[] = [];
        if (phone) dupConditions.push(eq(contactsTable.phone, phone));
        if (email) dupConditions.push(eq(contactsTable.email, email));
        const existing = await db.select({ id: contactsTable.id }).from(contactsTable).where(
          and(
            eq(contactsTable.businessId, businessId),
            or(...dupConditions) as ReturnType<typeof eq>,
          )
        );
        if (existing.length > 0) {
          skipped++;
          continue;
        }
      }

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

// GET /contacts/list
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

// POST /contacts/list
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

// DELETE /contacts/list/:id — scoped to userId
router.delete("/list/:id", async (req, res, next) => {
  try {
    const [list] = await db
      .select()
      .from(contactListsTable)
      .where(and(eq(contactListsTable.id, req.params.id!), eq(contactListsTable.userId, req.userId!)));
    if (!list) {
      res.status(404).json({ error: "List not found" });
      return;
    }
    await db.delete(contactListsTable).where(eq(contactListsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /contacts/list/:id/members — scoped: list must belong to userId's businesses
router.get("/list/:id/members", async (req, res, next) => {
  try {
    const [list] = await db
      .select()
      .from(contactListsTable)
      .where(and(eq(contactListsTable.id, req.params.id!), eq(contactListsTable.userId, req.userId!)));
    if (!list) {
      res.status(404).json({ error: "List not found" });
      return;
    }

    const members = await db
      .select({ contact: contactsTable })
      .from(contactListMembersTable)
      .innerJoin(contactsTable, eq(contactListMembersTable.contactId, contactsTable.id))
      .where(eq(contactListMembersTable.listId, req.params.id!));

    res.json(members.map((m) => mapContact(m.contact)));
  } catch (err) {
    next(err);
  }
});

// POST /contacts/list/:id/members — scoped to userId
router.post("/list/:id/members", async (req, res, next) => {
  try {
    const { contactId } = req.body;
    if (!contactId) {
      res.status(400).json({ error: "contactId required" });
      return;
    }

    const [list] = await db
      .select()
      .from(contactListsTable)
      .where(and(eq(contactListsTable.id, req.params.id!), eq(contactListsTable.userId, req.userId!)));
    if (!list) {
      res.status(404).json({ error: "List not found" });
      return;
    }

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.businessId, list.businessId)));
    if (!contact) {
      res.status(404).json({ error: "Contact not found in this business" });
      return;
    }

    const existing = await db
      .select()
      .from(contactListMembersTable)
      .where(and(eq(contactListMembersTable.listId, req.params.id!), eq(contactListMembersTable.contactId, contactId)));

    if (existing.length === 0) {
      await db.insert(contactListMembersTable).values({ listId: req.params.id!, contactId });
      await db.execute(
        sql`UPDATE contact_lists SET contact_count = (SELECT COUNT(*)::text FROM contact_list_members WHERE list_id = ${req.params.id!}) WHERE id = ${req.params.id!}`
      );
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /contacts/list/:id/members/:contactId — scoped to userId
router.delete("/list/:id/members/:contactId", async (req, res, next) => {
  try {
    const [list] = await db
      .select()
      .from(contactListsTable)
      .where(and(eq(contactListsTable.id, req.params.id!), eq(contactListsTable.userId, req.userId!)));
    if (!list) {
      res.status(404).json({ error: "List not found" });
      return;
    }

    await db
      .delete(contactListMembersTable)
      .where(
        and(
          eq(contactListMembersTable.listId, req.params.id!),
          eq(contactListMembersTable.contactId, req.params.contactId!),
        ),
      );
    await db.execute(
      sql`UPDATE contact_lists SET contact_count = (SELECT COUNT(*)::text FROM contact_list_members WHERE list_id = ${req.params.id!}) WHERE id = ${req.params.id!}`
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- DYNAMIC /:id ROUTES AFTER STATIC ONES ---

// GET /contacts/:id — scoped by businessId via userId's contacts
router.get("/:id", async (req, res, next) => {
  try {
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id!), eq(contactsTable.userId, req.userId!)));
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json(mapContact(contact));
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

// PATCH /contacts/:id — scoped to userId
router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = PatchContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const [existing] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id!), eq(contactsTable.userId, req.userId!)));
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    type ContactUpdate = Partial<Pick<typeof contactsTable.$inferInsert, "name" | "phone" | "email" | "tags" | "consentGiven" | "consentAt" | "dncListed">>;
    const updates: ContactUpdate = {};
    const { name, phone, email, tags, consentGiven, dncListed } = parsed.data;
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (tags !== undefined) updates.tags = tags;
    if (dncListed !== undefined) updates.dncListed = dncListed;
    if (consentGiven !== undefined) {
      updates.consentGiven = consentGiven;
      if (consentGiven) updates.consentAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      await db.update(contactsTable).set(updates).where(eq(contactsTable.id, req.params.id!));
    }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, req.params.id!));
    res.json(mapContact(contact!));
  } catch (err) {
    next(err);
  }
});

// DELETE /contacts/:id — scoped to userId
router.delete("/:id", async (req, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id!), eq(contactsTable.userId, req.userId!)));
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    await db.delete(contactsTable).where(eq(contactsTable.id, req.params.id!));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /contacts/:id/notes — scoped via contact ownership
router.get("/:id/notes", async (req, res, next) => {
  try {
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id!), eq(contactsTable.userId, req.userId!)));
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const notes = await db
      .select()
      .from(contactNotesTable)
      .where(eq(contactNotesTable.contactId, req.params.id!))
      .orderBy(desc(contactNotesTable.createdAt));

    res.json(notes.map(mapNote));
  } catch (err) {
    next(err);
  }
});

// POST /contacts/:id/notes — scoped via contact ownership
router.post("/:id/notes", async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text required" });
      return;
    }

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id!), eq(contactsTable.userId, req.userId!)));
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const id = generateToken(16);
    await db.insert(contactNotesTable).values({
      id,
      contactId: req.params.id!,
      text: text.trim(),
    });

    const [note] = await db.select().from(contactNotesTable).where(eq(contactNotesTable.id, id));
    res.status(201).json(mapNote(note!));
  } catch (err) {
    next(err);
  }
});

function parseCSV(text: string): { name?: string; email?: string; phone?: string }[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0]!;
  const headers = parseCSVRow(headerLine).map((h) => h.toLowerCase().trim());

  const nameIdx = headers.findIndex((h) => h.includes("name"));
  const emailIdx = headers.findIndex((h) => h.includes("email") || h.includes("e-mail"));
  const phoneIdx = headers.findIndex((h) => h.includes("phone") || h.includes("mobile") || h.includes("tel"));

  return lines.slice(1).map((line) => {
    const cols = parseCSVRow(line);
    const result: { name?: string; email?: string; phone?: string } = {};
    if (nameIdx >= 0 && cols[nameIdx]) result.name = cols[nameIdx]!.trim();
    if (emailIdx >= 0 && cols[emailIdx]) result.email = cols[emailIdx]!.trim();
    if (phoneIdx >= 0 && cols[phoneIdx]) result.phone = cols[phoneIdx]!.trim();
    return result;
  }).filter((r) => r.name || r.email || r.phone);
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function mapContact(c: typeof contactsTable.$inferSelect) {
  return {
    id: c.id,
    businessId: c.businessId,
    name: c.name,
    phone: c.phone,
    email: c.email,
    tags: (c.tags as string[]) ?? [],
    consentGiven: c.consentGiven,
    consentAt: c.consentAt?.toISOString() ?? null,
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

function mapNote(n: typeof contactNotesTable.$inferSelect) {
  return {
    id: n.id,
    contactId: n.contactId,
    text: n.text,
    createdAt: n.createdAt.toISOString(),
  };
}

export default router;
