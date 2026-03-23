/**
 * Entra ID (Azure AD) JWT validation middleware for Power BI OData analytics.
 *
 * SETUP GUIDE — Azure App Registration:
 * 1. Go to https://portal.azure.com -> Azure Active Directory -> App registrations -> New registration
 * 2. Name it "GoRigo Analytics", select "Accounts in this organizational directory only"
 * 3. After creation, copy the "Application (client) ID" -> set as ENTRA_CLIENT_ID env var
 * 4. Copy the "Directory (tenant) ID"                  -> set as ENTRA_TENANT_ID env var
 * 5. Under "Expose an API": click "Add a scope", set scope name e.g. "analytics.read"
 *    (App ID URI will be auto-assigned as api://<client-id>)
 * 6. Under "API permissions": add the above scope as a delegated permission for your app
 *
 * POWER BI ODATA CONNECTOR SETUP:
 * 1. In Power BI Desktop: Get Data -> OData Feed
 * 2. URL: https://<your-domain>/api/analytics/$metadata
 * 3. Authentication: OAuth2 / Organizational Account -> Sign in with Microsoft
 *    (Power BI handles the OAuth2 PKCE flow automatically)
 * 4. For Power BI Service scheduled refresh: configure the data source credentials
 *    in the dataset settings using your Microsoft account (OAuth2)
 *
 * TOKEN VALIDATION:
 * - Tokens are validated against Microsoft's public JWKS endpoint
 * - Checks: signature, expiry, issuer (tid), audience (aud = client ID)
 * - No GoRigo-specific password required — identity is purely Microsoft-based
 */

import { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const TENANT_ID = process.env["ENTRA_TENANT_ID"];
const CLIENT_ID = process.env["ENTRA_CLIENT_ID"];

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwksCache) {
    const url = TENANT_ID
      ? `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`
      : "https://login.microsoftonline.com/common/discovery/v2.0/keys";
    jwksCache = createRemoteJWKSet(new URL(url));
  }
  return jwksCache;
}

/**
 * Middleware that validates Microsoft Entra ID Bearer tokens.
 * Verifies:
 * - Signature (against Microsoft's public JWKS)
 * - Expiry
 * - Issuer (tid must match ENTRA_TENANT_ID)
 * - Audience (aud must match ENTRA_CLIENT_ID)
 * - Subject identity: the token's oid must match the stored admin user's microsoft_oid
 *   ensuring only the linked owner account can access analytics.
 * Rejects with 401 if the token is missing, invalid, or not the owner's account.
 */
export async function requireEntraAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!TENANT_ID || !CLIENT_ID) {
    res.status(503).json({
      error: "Analytics not configured",
      message: "ENTRA_TENANT_ID and ENTRA_CLIENT_ID environment variables must be set.",
    });
    return;
  }

  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  const token = auth.slice(7);

  try {
    const jwks = getJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: [
        `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
        `https://sts.windows.net/${TENANT_ID}/`,
      ],
      audience: CLIENT_ID,
    });

    if (payload.tid !== TENANT_ID) {
      res.status(401).json({ error: "Token tenant mismatch" });
      return;
    }

    const tokenOid = payload["oid"] as string | undefined;

    if (!tokenOid) {
      res.status(401).json({ error: "Token missing subject identity" });
      return;
    }

    const [adminUser] = await db
      .select({ id: usersTable.id, microsoftOid: usersTable.microsoftOid, isAdminUser: usersTable.isAdminUser })
      .from(usersTable)
      .where(eq(usersTable.microsoftOid, tokenOid))
      .limit(1);

    if (!adminUser || !adminUser.isAdminUser) {
      res.status(403).json({ error: "Access denied: token does not belong to the registered admin account" });
      return;
    }

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token validation failed";
    res.status(401).json({ error: "Unauthorized", message });
  }
}
