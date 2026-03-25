import { db } from "@workspace/db";
import { toolConnectionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto.js";
import { logger } from "./logger.js";

interface ToolCredentials {
  accessToken?: string;
  apiKey?: string;
  trelloKey?: string;
  trelloToken?: string;
}

const GOOGLE_TOOL_NAMES = ["gmail", "google_calendar", "google_sheets"];
const GOOGLE_OAUTH_CONFIG = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
};

async function refreshGoogleToken(conn: typeof toolConnectionsTable.$inferSelect): Promise<boolean> {
  if (!conn.refreshToken) return false;

  const clientId = process.env[GOOGLE_OAUTH_CONFIG.clientIdEnv];
  const clientSecret = process.env[GOOGLE_OAUTH_CONFIG.clientSecretEnv];
  if (!clientId || !clientSecret) return false;

  try {
    const tokenResp = await fetch(GOOGLE_OAUTH_CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResp.ok) return false;

    const tokenData = await tokenResp.json() as { access_token: string; expires_in?: number };
    const newExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    const raw = decrypt(conn.encryptedCredentials, conn.encryptedDek);
    const existing = JSON.parse(raw) as Record<string, unknown>;
    existing.accessToken = tokenData.access_token;
    const { encryptedPayload, encryptedDek } = encrypt(JSON.stringify(existing));

    for (const tName of GOOGLE_TOOL_NAMES) {
      await db
        .update(toolConnectionsTable)
        .set({
          encryptedCredentials: encryptedPayload,
          encryptedDek,
          tokenExpiresAt: newExpiresAt,
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(toolConnectionsTable.userId, conn.userId),
            eq(toolConnectionsTable.toolName, tName),
          ),
        );
    }

    logger.info({ userId: conn.userId }, "On-demand Google token refresh succeeded");
    return true;
  } catch (e) {
    logger.warn({ e, userId: conn.userId }, "On-demand Google token refresh failed");
    return false;
  }
}

interface ToolAuthExpiredResult {
  error: "tool_auth_expired";
  message: string;
  toolName: string;
}

async function ensureTokenFresh(userId: string, toolName: string): Promise<ToolAuthExpiredResult | null> {
  const [conn] = await db
    .select()
    .from(toolConnectionsTable)
    .where(
      and(
        eq(toolConnectionsTable.userId, userId),
        eq(toolConnectionsTable.toolName, toolName),
        eq(toolConnectionsTable.status, "active"),
      ),
    )
    .limit(1);

  if (!conn || conn.credentialType !== "oauth2" || !conn.refreshToken) return null;

  if (!conn.tokenExpiresAt) return null;

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (conn.tokenExpiresAt > fiveMinutesFromNow) return null;

  const isGoogleTool = GOOGLE_TOOL_NAMES.includes(toolName);
  if (isGoogleTool) {
    const refreshed = await refreshGoogleToken(conn);
    if (!refreshed) {
      return {
        error: "tool_auth_expired",
        message: `Your Google connection needs to be reconnected. Go to Settings → Tools to reconnect.`,
        toolName,
      };
    }
    return null;
  }

  return {
    error: "tool_auth_expired",
    message: `Your ${toolName} connection needs to be reconnected. Go to Settings → Tools to reconnect.`,
    toolName,
  };
}

async function getCredentials(
  userId: string,
  toolName: string,
  allowPending = false,
): Promise<ToolCredentials> {
  const conditions = [
    eq(toolConnectionsTable.userId, userId),
    eq(toolConnectionsTable.toolName, toolName),
  ];

  if (!allowPending) {
    conditions.push(eq(toolConnectionsTable.status, "active"));
  }

  const [conn] = await db
    .select()
    .from(toolConnectionsTable)
    .where(and(...conditions));

  if (!conn) {
    throw new Error(`No ${allowPending ? "" : "active "}connection for tool: ${toolName}`);
  }

  if (!allowPending && conn.status !== "active" && conn.status !== "expiring_soon") {
    throw new Error(`Connection for tool ${toolName} is not active (status: ${conn.status})`);
  }

  const raw = decrypt(conn.encryptedCredentials, conn.encryptedDek);
  return JSON.parse(raw) as ToolCredentials;
}

async function executeGmail(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "gmail", allowPending);
  const resp = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX",
    { headers: { Authorization: `Bearer ${creds.accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Gmail API error: ${resp.status}`);
  const data = await resp.json() as { messages?: { id: string }[] };

  const messages = await Promise.all(
    (data.messages ?? []).slice(0, 10).map(async (m) => {
      const msgResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${creds.accessToken}` } },
      );
      const msg = await msgResp.json() as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string };
      const headers = msg.payload?.headers ?? [];
      return {
        id: m.id,
        subject: headers.find((h) => h.name === "Subject")?.value ?? "(no subject)",
        from: headers.find((h) => h.name === "From")?.value ?? "",
        date: headers.find((h) => h.name === "Date")?.value ?? "",
        snippet: msg.snippet ?? "",
      };
    }),
  );
  return { messages };
}

async function executeGoogleCalendar(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "google_calendar", allowPending);
  const now = new Date().toISOString();
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=10&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${creds.accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google Calendar API error: ${resp.status}`);
  const data = await resp.json() as { items?: unknown[] };
  return { events: data.items ?? [] };
}

async function executeGoogleSheets(userId: string, params?: { spreadsheetId?: string }, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "google_sheets", allowPending);
  const spreadsheetId = params?.spreadsheetId;
  if (!spreadsheetId) throw new Error("spreadsheetId is required for Google Sheets");

  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:Z100`,
    { headers: { Authorization: `Bearer ${creds.accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google Sheets API error: ${resp.status}`);
  const data = await resp.json();
  return data;
}

async function executeSlack(userId: string, params?: { channel?: string; message?: string; action?: string }, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "slack", allowPending);
  const action = params?.action ?? "send_message";

  if (action === "send_message") {
    if (!params?.channel || !params?.message) throw new Error("channel and message are required");
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: params.channel, text: params.message }),
    });
    const data = await resp.json() as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  const resp = await fetch("https://slack.com/api/conversations.list?limit=10", {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  });
  const data = await resp.json() as { ok: boolean; channels?: unknown[] };
  return { channels: data.channels ?? [] };
}

async function executeNotion(userId: string, params?: { query?: string }, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "notion", allowPending);
  const resp = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({ query: params?.query ?? "", page_size: 10 }),
  });
  if (!resp.ok) throw new Error(`Notion API error: ${resp.status}`);
  const data = await resp.json() as { results?: unknown[] };
  return { pages: data.results ?? [] };
}

async function executeXero(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "xero", allowPending);
  const orgResp = await fetch("https://api.xero.com/api.xro/2.0/Organisation", {
    headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
  });
  if (!orgResp.ok) throw new Error(`Xero API error: ${orgResp.status}`);
  const orgData = await orgResp.json() as { Organisations?: unknown[] };

  const invResp = await fetch("https://api.xero.com/api.xro/2.0/Invoices?page=1&pageSize=1&order=UpdatedDateUTC+DESC", {
    headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
  });
  const invData = invResp.ok ? await invResp.json() as { Invoices?: unknown[] } : { Invoices: [] };

  return {
    organisation: (orgData.Organisations ?? [])[0] ?? null,
    lastInvoice: (invData.Invoices ?? [])[0] ?? null,
  };
}

async function executeStripe(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "stripe", allowPending);
  const auth = Buffer.from(`${creds.apiKey}:`).toString("base64");

  const [balanceResp, paymentsResp] = await Promise.all([
    fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Basic ${auth}` },
    }),
    fetch("https://api.stripe.com/v1/payment_intents?limit=5", {
      headers: { Authorization: `Basic ${auth}` },
    }),
  ]);

  if (!balanceResp.ok) throw new Error(`Stripe balance API error: ${balanceResp.status}`);
  const balance = await balanceResp.json();
  const payments = paymentsResp.ok ? await paymentsResp.json() as { data?: unknown[] } : { data: [] };

  return { balance, recentPayments: payments.data ?? [] };
}

async function executeTrello(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "trello", allowPending);
  const auth = `key=${creds.trelloKey}&token=${creds.trelloToken}`;

  const boardsResp = await fetch(`https://api.trello.com/1/members/me/boards?fields=name,url&${auth}`);
  if (!boardsResp.ok) throw new Error(`Trello API error: ${boardsResp.status}`);
  const boards = await boardsResp.json() as { id: string; name: string }[];

  const cards = boards.length > 0
    ? await fetch(`https://api.trello.com/1/boards/${boards[0]!.id}/cards?${auth}`)
        .then((r) => r.json() as Promise<unknown[]>)
    : [];

  return { boards, cards };
}

async function executeFacebook(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "facebook", allowPending);
  const pagesResp = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,fan_count&access_token=${creds.accessToken}`,
  );
  if (!pagesResp.ok) throw new Error(`Facebook API error: ${pagesResp.status}`);
  const pagesData = await pagesResp.json() as { data?: { id: string; name: string; access_token?: string }[] };
  const page = (pagesData.data ?? [])[0];

  let posts: unknown[] = [];
  if (page) {
    const postsResp = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}/posts?limit=3&fields=message,created_time&access_token=${page.access_token ?? creds.accessToken}`,
    );
    const postsData = postsResp.ok ? await postsResp.json() as { data?: unknown[] } : { data: [] };
    posts = postsData.data ?? [];
  }

  return { page: page ?? null, recentPosts: posts };
}

async function executeLinkedIn(userId: string, allowPending = false): Promise<unknown> {
  const creds = await getCredentials(userId, "linkedin", allowPending);
  const resp = await fetch(
    "https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))",
    { headers: { Authorization: `Bearer ${creds.accessToken}` } },
  );
  if (!resp.ok) throw new Error(`LinkedIn API error: ${resp.status}`);
  const profile = await resp.json();
  return { profile };
}

export async function executeTool(
  userId: string,
  toolName: string,
  action: string,
  params?: Record<string, unknown>,
  allowPending = false,
): Promise<unknown> {
  if (!allowPending) {
    const authError = await ensureTokenFresh(userId, toolName);
    if (authError) return authError;

    await db
      .update(toolConnectionsTable)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(toolConnectionsTable.userId, userId),
          eq(toolConnectionsTable.toolName, toolName),
        ),
      );
  }

  switch (toolName) {
    case "gmail":
      return executeGmail(userId, allowPending);
    case "google_calendar":
      return executeGoogleCalendar(userId, allowPending);
    case "google_sheets":
      return executeGoogleSheets(userId, params as { spreadsheetId?: string }, allowPending);
    case "slack":
      return executeSlack(userId, params as { channel?: string; message?: string; action?: string }, allowPending);
    case "notion":
      return executeNotion(userId, params as { query?: string }, allowPending);
    case "xero":
      return executeXero(userId, allowPending);
    case "stripe":
      return executeStripe(userId, allowPending);
    case "trello":
      return executeTrello(userId, allowPending);
    case "facebook":
      return executeFacebook(userId, allowPending);
    case "linkedin":
      return executeLinkedIn(userId, allowPending);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
