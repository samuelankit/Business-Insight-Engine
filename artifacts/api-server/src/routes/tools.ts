import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { toolConnectionsTable, oauthStatesTable } from "@workspace/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { encrypt, decrypt, generateToken, generateOAuthState, generateCodeVerifier } from "../lib/crypto.js";
import { createHash } from "crypto";
import { executeTool } from "../lib/toolExecutor.js";

const router = Router();

const WAVE1_TOOLS = [
  "gmail", "google_calendar", "google_sheets", "notion", "slack",
  "xero", "stripe", "trello", "facebook", "linkedin",
];

const AVAILABLE_TOOLS = [
  { name: "gmail", label: "Gmail", description: "Read inbox messages and send emails", credentialType: "oauth2", functions: ["read_inbox", "send_email"], oauthProvider: "google" },
  { name: "google_calendar", label: "Google Calendar", description: "View and manage calendar events", credentialType: "oauth2", functions: ["list_events", "create_event"], oauthProvider: "google" },
  { name: "google_sheets", label: "Google Sheets", description: "Read and write spreadsheet data", credentialType: "oauth2", functions: ["read_sheet", "append_rows"], oauthProvider: "google" },
  { name: "notion", label: "Notion", description: "Search pages and manage databases", credentialType: "oauth2", functions: ["search_pages", "create_page"], oauthProvider: "notion" },
  { name: "slack", label: "Slack", description: "Send messages to channels and workspaces", credentialType: "oauth2", functions: ["send_message", "list_channels"], oauthProvider: "slack" },
  { name: "xero", label: "Xero", description: "View invoices and accounting data", credentialType: "oauth2", functions: ["get_organisation", "list_invoices"], oauthProvider: "xero" },
  { name: "stripe", label: "Stripe", description: "View payments, customers and balance", credentialType: "api_key", functions: ["get_balance", "list_payments"] },
  { name: "trello", label: "Trello", description: "Manage boards and cards", credentialType: "api_key", functions: ["list_boards", "list_cards"] },
  { name: "facebook", label: "Facebook", description: "Manage pages and view posts", credentialType: "oauth2", functions: ["get_page", "list_posts"], oauthProvider: "facebook" },
  { name: "linkedin", label: "LinkedIn", description: "View profile information", credentialType: "oauth2", functions: ["get_profile"], oauthProvider: "linkedin" },
];

const OAUTH_CONFIG: Record<string, {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "openid",
      "email",
      "profile",
    ],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  notion: {
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    scopes: ["channels:read", "chat:write", "users:read"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
  },
  xero: {
    authUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    revokeUrl: "https://identity.xero.com/connect/revocation",
    scopes: ["openid", "profile", "email", "accounting.transactions.read", "accounting.reports.read", "offline_access"],
    clientIdEnv: "XERO_CLIENT_ID",
    clientSecretEnv: "XERO_CLIENT_SECRET",
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement"],
    clientIdEnv: "FACEBOOK_APP_ID",
    clientSecretEnv: "FACEBOOK_APP_SECRET",
  },
  linkedin: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["r_liteprofile"],
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
  },
};

const GOOGLE_TOOL_NAMES = ["gmail", "google_calendar", "google_sheets"];

router.get("/oauth/:provider/callback", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      res.redirect(`gorigo://oauth-callback?error=${encodeURIComponent(error)}&provider=${provider}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    const config = OAUTH_CONFIG[provider!];
    if (!config) {
      res.status(400).json({ error: "Unknown provider" });
      return;
    }

    const now = new Date();
    const [oauthState] = await db
      .select()
      .from(oauthStatesTable)
      .where(
        and(
          eq(oauthStatesTable.state, state),
          eq(oauthStatesTable.provider, provider!),
        ),
      );

    if (!oauthState || oauthState.expiresAt < now) {
      res.redirect(`gorigo://oauth-callback?error=invalid_state&provider=${provider}`);
      return;
    }

    const userId = oauthState.userId;
    const domain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"]?.split(",")[0];
    const redirectUri = `https://${domain}/api/tools/oauth/${provider}/callback`;
    const clientId = process.env[config.clientIdEnv] ?? "";
    const clientSecret = process.env[config.clientSecretEnv] ?? "";

    let tokenBody: URLSearchParams;
    if (provider === "notion") {
      tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
    } else {
      tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        ...(oauthState.codeVerifier ? { code_verifier: oauthState.codeVerifier } : {}),
      });
    }

    const tokenHeaders: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (provider === "notion") {
      tokenHeaders["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    }

    const tokenResp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: tokenHeaders,
      body: tokenBody,
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error(`Token exchange error for ${provider}:`, errText);
      res.redirect(`gorigo://oauth-callback?error=token_exchange_failed&provider=${provider}`);
      return;
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      authed_user?: { access_token: string };
    };

    const accessToken = provider === "slack"
      ? (tokenData.authed_user?.access_token ?? tokenData.access_token)
      : tokenData.access_token;

    const refreshToken = tokenData.refresh_token ?? null;
    const expiresIn = tokenData.expires_in ?? null;
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    const credentials = JSON.stringify({ accessToken, ...(refreshToken ? { refreshToken } : {}) });
    const { encryptedPayload, encryptedDek } = encrypt(credentials);

    const toolNames = provider === "google" ? GOOGLE_TOOL_NAMES : [
      AVAILABLE_TOOLS.find((t) => t.oauthProvider === provider)?.name ?? provider!,
    ];

    const insertedIds: string[] = [];
    for (const toolName of toolNames) {
      await db
        .delete(toolConnectionsTable)
        .where(
          and(
            eq(toolConnectionsTable.userId, userId),
            eq(toolConnectionsTable.toolName, toolName),
          ),
        );

      const id = generateToken(16);
      await db.insert(toolConnectionsTable).values({
        id,
        userId,
        toolName,
        credentialType: "oauth2",
        encryptedCredentials: encryptedPayload,
        encryptedDek,
        status: "pending_test",
        refreshToken: refreshToken ?? null,
        tokenExpiresAt,
        scopes: config.scopes,
      });
      insertedIds.push(id);
    }

    const testToolName = toolNames[0]!;
    let testPassed = false;
    try {
      const testParams = testToolName === "slack" ? { action: "list_channels" } : undefined;
      await executeTool(userId, testToolName, "default", testParams, true);
      testPassed = true;
    } catch (testErr) {
      console.warn(`[OAuth callback] Connection test failed for ${provider}/${testToolName}:`, testErr);
    }

    if (testPassed) {
      for (const id of insertedIds) {
        await db
          .update(toolConnectionsTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(toolConnectionsTable.id, id));
      }
      await db.delete(oauthStatesTable).where(eq(oauthStatesTable.id, oauthState.id));
      res.redirect(`gorigo://oauth-callback?success=true&provider=${provider}`);
    } else {
      for (const id of insertedIds) {
        await db.delete(toolConnectionsTable).where(eq(toolConnectionsTable.id, id));
      }
      await db.delete(oauthStatesTable).where(eq(oauthStatesTable.id, oauthState.id));
      res.redirect(`gorigo://oauth-callback?error=connection_test_failed&provider=${provider}`);
    }
  } catch (err) {
    console.error("OAuth callback error:", err);
    next(err);
  }
});

router.use(requireAuth);

router.get("/available", async (req, res, next) => {
  try {
    const connections = await db
      .select()
      .from(toolConnectionsTable)
      .where(eq(toolConnectionsTable.userId, req.userId!));

    const now = new Date();
    const tools = AVAILABLE_TOOLS.map((t) => {
      const conn = connections.find((c) => c.toolName === t.name);
      const isConnected = !!conn && conn.status === "active";
      const isExpiringSoon = !!conn && conn.status === "expiring_soon";
      const tokenExpiresAt = conn?.tokenExpiresAt ?? null;
      const nearingExpiryByTime = tokenExpiresAt
        ? tokenExpiresAt.getTime() - now.getTime() < 24 * 60 * 60 * 1000
        : false;
      const nearingExpiry = isExpiringSoon || (isConnected && nearingExpiryByTime);

      return {
        ...t,
        isConnected: isConnected || isExpiringSoon,
        connectionId: conn?.id ?? null,
        tokenExpiresAt: tokenExpiresAt?.toISOString() ?? null,
        nearingExpiry,
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

router.get("/oauth/:provider/start", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const config = OAUTH_CONFIG[provider!];
    if (!config) {
      res.status(400).json({ error: "Unknown OAuth provider" });
      return;
    }

    const clientId = process.env[config.clientIdEnv];
    if (!clientId) {
      res.status(503).json({ error: `OAuth not configured for ${provider}` });
      return;
    }

    const domain = process.env["REPLIT_DEV_DOMAIN"] ?? process.env["REPLIT_DOMAINS"]?.split(",")[0];
    const redirectUri = `https://${domain}/api/tools/oauth/${provider}/callback`;

    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const stateId = generateToken(16);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.delete(oauthStatesTable).where(
      and(
        eq(oauthStatesTable.userId, req.userId!),
        eq(oauthStatesTable.provider, provider!),
      ),
    );

    await db.insert(oauthStatesTable).values({
      id: stateId,
      userId: req.userId!,
      provider: provider!,
      state,
      codeVerifier,
      expiresAt,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: config.scopes.join(" "),
      ...(provider === "google" ? { access_type: "offline", prompt: "consent" } : {}),
      ...(provider !== "notion" && provider !== "facebook" ? {
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      } : {}),
    });

    const authUrl = `${config.authUrl}?${params.toString()}`;
    res.json({ authUrl, state });
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
      status: "pending_test",
      scopes,
    });

    const [conn] = await db.select().from(toolConnectionsTable).where(eq(toolConnectionsTable.id, id));
    res.status(201).json(mapConnection(conn!));
  } catch (err) {
    next(err);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const { toolName, connectionId } = req.body as { toolName?: string; connectionId?: string };
    if (!toolName) {
      res.status(400).json({ error: "toolName is required" });
      return;
    }

    try {
      const testParams = toolName === "slack" ? { action: "list_channels" } : undefined;
      const result = await executeTool(req.userId!, toolName, "default", testParams, true);

      if (connectionId) {
        await db
          .update(toolConnectionsTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(toolConnectionsTable.id, connectionId),
              eq(toolConnectionsTable.userId, req.userId!),
            ),
          );
      }

      res.json({ success: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test failed";
      res.status(400).json({ success: false, error: msg });
    }
  } catch (err) {
    next(err);
  }
});

router.post("/execute", async (req, res, next) => {
  try {
    const { toolName, action, params } = req.body as {
      toolName?: string;
      action?: string;
      params?: Record<string, unknown>;
    };

    if (!toolName || !action) {
      res.status(400).json({ error: "toolName and action are required" });
      return;
    }

    if (!WAVE1_TOOLS.includes(toolName)) {
      res.status(400).json({ error: `Tool ${toolName} is not available` });
      return;
    }

    const result = await executeTool(req.userId!, toolName, action, params);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/connections/:id", async (req, res, next) => {
  try {
    const [conn] = await db
      .select()
      .from(toolConnectionsTable)
      .where(
        and(
          eq(toolConnectionsTable.id, req.params.id!),
          eq(toolConnectionsTable.userId, req.userId!),
        ),
      );

    if (!conn) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    try {
      if (conn.credentialType === "oauth2") {
        const raw = decrypt(conn.encryptedCredentials, conn.encryptedDek);
        const creds = JSON.parse(raw) as { accessToken?: string };
        const tool = AVAILABLE_TOOLS.find((t) => t.name === conn.toolName);
        if (tool?.oauthProvider && creds.accessToken) {
          const cfg = OAUTH_CONFIG[tool.oauthProvider];
          if (cfg?.revokeUrl) {
            if (tool.oauthProvider === "google") {
              await fetch(`${cfg.revokeUrl}?token=${creds.accessToken}`, { method: "POST" });
            } else {
              await fetch(cfg.revokeUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ token: creds.accessToken }),
              });
            }
          }
        }
      }
    } catch (revokeErr) {
      console.warn("Token revocation failed (continuing with DB delete):", revokeErr);
    }

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
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function refreshExpiredTokens() {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiring = await db
      .select()
      .from(toolConnectionsTable)
      .where(lt(toolConnectionsTable.tokenExpiresAt, in24h));

    for (const conn of expiring) {
      if (conn.credentialType !== "oauth2" || !conn.refreshToken) continue;

      const tool = AVAILABLE_TOOLS.find((t) => t.name === conn.toolName);
      if (!tool?.oauthProvider) continue;

      if (tool.oauthProvider === "google") {
        const cfg = OAUTH_CONFIG["google"]!;
        const clientId = process.env[cfg.clientIdEnv];
        const clientSecret = process.env[cfg.clientSecretEnv];
        if (!clientId || !clientSecret) continue;

        try {
          const tokenResp = await fetch(cfg.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: conn.refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }),
          });

          if (tokenResp.ok) {
            const tokenData = await tokenResp.json() as {
              access_token: string;
              expires_in?: number;
            };
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
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(toolConnectionsTable.userId, conn.userId),
                    eq(toolConnectionsTable.toolName, tName),
                  ),
                );
            }
            console.info(`[tokenRefresh] Silently refreshed Google token for user ${conn.userId}`);
          } else {
            console.warn(`[tokenRefresh] Google token refresh failed for user ${conn.userId} — marking expiring_soon`);
            await db
              .update(toolConnectionsTable)
              .set({ status: "expiring_soon", updatedAt: now })
              .where(eq(toolConnectionsTable.id, conn.id));
          }
        } catch (e) {
          console.warn(`[tokenRefresh] Failed to refresh Google token:`, e);
        }
      } else {
        console.info(`[tokenRefresh] Non-Google token expiring for user ${conn.userId} tool ${conn.toolName} — marking expiring_soon`);
        await db
          .update(toolConnectionsTable)
          .set({ status: "expiring_soon", updatedAt: now })
          .where(eq(toolConnectionsTable.id, conn.id));
      }
    }
  } catch (err) {
    console.error("[tokenRefresh] Background job failed:", err);
  }
}

export default router;
