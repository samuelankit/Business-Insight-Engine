import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { toolConnectionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { encrypt, decrypt, generateToken } from "../lib/crypto.js";

const router = Router();
router.use(requireAuth);

const AVAILABLE_TOOLS = [
  { name: "gmail", description: "Read and send emails via Gmail", credentialType: "oauth2", functions: ["read_inbox", "send_email", "reply_email", "search_messages"] },
  { name: "google_calendar", description: "Manage Google Calendar events", credentialType: "oauth2", functions: ["list_events", "create_event", "check_availability"] },
  { name: "google_sheets", description: "Read and write Google Sheets data", credentialType: "oauth2", functions: ["list_sheets", "read_sheet", "append_rows", "update_cells"] },
  { name: "notion", description: "Read and write Notion pages and databases", credentialType: "oauth2", functions: ["search_pages", "create_page", "read_page", "query_database"] },
  { name: "slack", description: "Send messages and read Slack channels", credentialType: "oauth2", functions: ["list_channels", "send_message", "read_messages", "search_messages"] },
  { name: "xero", description: "Manage invoices and accounting in Xero", credentialType: "oauth2", functions: ["list_invoices", "create_invoice", "get_organisation", "list_expenses"] },
  { name: "stripe", description: "View Stripe payments and customers", credentialType: "api_key", functions: ["get_balance", "list_payments", "list_invoices", "list_customers"] },
  { name: "trello", description: "Manage Trello boards and cards", credentialType: "api_key", functions: ["list_boards", "list_cards", "create_card", "move_card"] },
  { name: "whatsapp", description: "Send WhatsApp Business messages", credentialType: "api_key", functions: ["send_message", "send_template", "list_templates"] },
  { name: "facebook", description: "Manage Facebook Pages and posts", credentialType: "api_key", functions: ["list_pages", "publish_post", "list_posts", "get_insights"] },
  { name: "linkedin", description: "Post to LinkedIn profile and company pages", credentialType: "api_key", functions: ["get_profile", "create_post", "list_posts"] },
  { name: "twitter", description: "Post to X (Twitter) and search tweets", credentialType: "api_key", functions: ["create_tweet", "list_tweets", "search_tweets"] },
];

router.get("/available", async (req, res, next) => {
  try {
    const connections = await db
      .select()
      .from(toolConnectionsTable)
      .where(eq(toolConnectionsTable.userId, req.userId!));

    const connectedNames = new Set(connections.map((c) => c.toolName));

    const tools = AVAILABLE_TOOLS.map((t) => {
      const conn = connections.find((c) => c.toolName === t.name);
      return {
        ...t,
        isConnected: connectedNames.has(t.name),
        connectionId: conn?.id ?? null,
      };
    });

    res.json(tools);
  } catch (err) {
    next(err);
  }
});

router.get("/connections", async (req, res, next) => {
  try {
    const connections = await db
      .select()
      .from(toolConnectionsTable)
      .where(eq(toolConnectionsTable.userId, req.userId!));

    res.json(connections.map(mapConnection));
  } catch (err) {
    next(err);
  }
});

const ConnectSchema = z.object({
  toolName: z.string(),
  credentials: z.string(),
  scopes: z.array(z.string()).optional(),
});

router.post("/connections", async (req, res, next) => {
  try {
    const parsed = ConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { toolName, credentials, scopes } = parsed.data;
    const { encryptedPayload, encryptedDek } = encrypt(credentials);

    const id = generateToken(16);
    const tool = AVAILABLE_TOOLS.find((t) => t.name === toolName);

    // Remove existing connection for this tool
    await db
      .delete(toolConnectionsTable)
      .where(
        and(
          eq(toolConnectionsTable.userId, req.userId!),
          eq(toolConnectionsTable.toolName, toolName),
        ),
      );

    await db.insert(toolConnectionsTable).values({
      id,
      userId: req.userId!,
      toolName,
      credentialType: tool?.credentialType ?? "api_key",
      encryptedCredentials: encryptedPayload,
      encryptedDek,
      status: "active",
      scopes,
    });

    const [conn] = await db.select().from(toolConnectionsTable).where(eq(toolConnectionsTable.id, id));
    res.status(201).json(mapConnection(conn!));
  } catch (err) {
    next(err);
  }
});

router.delete("/connections/:id", async (req, res, next) => {
  try {
    await db
      .delete(toolConnectionsTable)
      .where(
        and(
          eq(toolConnectionsTable.id, req.params.id!),
          eq(toolConnectionsTable.userId, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

function mapConnection(c: typeof toolConnectionsTable.$inferSelect) {
  return {
    id: c.id,
    toolName: c.toolName,
    status: c.status,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
