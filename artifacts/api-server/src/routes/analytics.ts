/**
 * OData v4 Analytics Router — Power BI / Microsoft Tools integration.
 *
 * All endpoints are protected by Entra ID JWT validation (requireEntraAuth).
 * Authentication uses the same Microsoft account as the admin login in the app.
 *
 * Supported OData query parameters: $top, $skip, $filter (date range on createdAt), $orderby
 *
 * OData Feed URL for Power BI: https://<domain>/api/analytics/$metadata
 *
 * @see artifacts/api-server/src/lib/entra-auth.ts for setup instructions
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  businessesTable,
  usageEventsTable,
  walletTransactionsTable,
  agentsTable,
  agentLogsTable,
  userSubscriptionsTable,
  walletsTable,
} from "@workspace/db/schema";
import { count, sum, desc, asc, gte, lte, and, SQL, Column } from "drizzle-orm";
import { requireEntraAuth } from "../lib/entra-auth.js";

const router = Router();

const ODATA_CONTEXT_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api/analytics`
  : "https://localhost/api/analytics";

function odataContext(entity: string) {
  return `${ODATA_CONTEXT_BASE}/$metadata#${entity}`;
}

const ALLOWED_ORDER_FIELDS = new Set([
  "createdAt", "updatedAt", "id", "userId", "businessId",
  "name", "type", "status", "planId", "amountPence", "eventType", "isActive",
]);

interface ODataQueryParams {
  top: number;
  skip: number;
  filterFrom: Date | null;
  filterTo: Date | null;
  orderField: string;
  orderDir: "asc" | "desc";
}

function parseODataParams(query: Record<string, unknown>): ODataQueryParams {
  const top = Math.min(Number(query["$top"] ?? 1000), 5000);
  const skip = Number(query["$skip"] ?? 0);
  const orderby = String(query["$orderby"] ?? "createdAt desc");
  const orderParts = orderby.trim().split(/\s+/);
  const rawField = orderParts[0] ?? "createdAt";
  const orderField = ALLOWED_ORDER_FIELDS.has(rawField) ? rawField : "createdAt";
  const orderDir: "asc" | "desc" = (orderParts[1] ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

  let filterFrom: Date | null = null;
  let filterTo: Date | null = null;

  const filter = String(query["$filter"] ?? "");
  if (filter) {
    const fromMatch = filter.match(/createdAt\s+ge\s+'?([^'\s&]+)'?/i);
    const toMatch = filter.match(/createdAt\s+le\s+'?([^'\s&]+)'?/i);
    if (fromMatch?.[1]) {
      const d = new Date(fromMatch[1]);
      if (!isNaN(d.getTime())) filterFrom = d;
    }
    if (toMatch?.[1]) {
      const d = new Date(toMatch[1]);
      if (!isNaN(d.getTime())) filterTo = d;
    }
  }

  return { top, skip, filterFrom, filterTo, orderField, orderDir };
}

function orderClause(col: Column, dir: "asc" | "desc") {
  return dir === "asc" ? asc(col) : desc(col);
}

function buildDateFilter(
  column: Parameters<typeof gte>[0],
  filterFrom: Date | null,
  filterTo: Date | null,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (filterFrom) conditions.push(gte(column, filterFrom));
  if (filterTo) conditions.push(lte(column, filterTo));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

router.get("/", requireEntraAuth, (_req, res) => {
  res.json({
    "@odata.context": `${ODATA_CONTEXT_BASE}/$metadata`,
    value: [
      { name: "users", kind: "EntitySet", url: "users" },
      { name: "businesses", kind: "EntitySet", url: "businesses" },
      { name: "usage", kind: "EntitySet", url: "usage" },
      { name: "revenue", kind: "EntitySet", url: "revenue" },
      { name: "agents", kind: "EntitySet", url: "agents" },
      { name: "subscriptions", kind: "EntitySet", url: "subscriptions" },
      { name: "overview", kind: "Singleton", url: "overview" },
    ],
  });
});

router.get("/$metadata", requireEntraAuth, (_req, res) => {
  res.set("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="GoRigo.Analytics" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="User">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="platform" Type="Edm.String"/>
        <Property Name="email" Type="Edm.String"/>
        <Property Name="emailVerified" Type="Edm.Boolean"/>
        <Property Name="suspended" Type="Edm.Boolean"/>
        <Property Name="walletBalancePence" Type="Edm.Int32"/>
        <Property Name="planId" Type="Edm.String"/>
        <Property Name="subscriptionStatus" Type="Edm.String"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityType Name="Business">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="userId" Type="Edm.String"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="sector" Type="Edm.String"/>
        <Property Name="country" Type="Edm.String"/>
        <Property Name="accountType" Type="Edm.String"/>
        <Property Name="intent" Type="Edm.String"/>
        <Property Name="isActive" Type="Edm.Boolean"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityType Name="UsageEvent">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="userId" Type="Edm.String"/>
        <Property Name="businessId" Type="Edm.String"/>
        <Property Name="eventType" Type="Edm.String"/>
        <Property Name="tokensConsumed" Type="Edm.Int64"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityType Name="WalletTransaction">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="userId" Type="Edm.String"/>
        <Property Name="type" Type="Edm.String"/>
        <Property Name="amountPence" Type="Edm.Int32"/>
        <Property Name="description" Type="Edm.String"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityType Name="Agent">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="userId" Type="Edm.String"/>
        <Property Name="businessId" Type="Edm.String"/>
        <Property Name="name" Type="Edm.String"/>
        <Property Name="type" Type="Edm.String"/>
        <Property Name="scheduleType" Type="Edm.String"/>
        <Property Name="isActive" Type="Edm.Boolean"/>
        <Property Name="lastRunAt" Type="Edm.DateTimeOffset"/>
        <Property Name="nextRunAt" Type="Edm.DateTimeOffset"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
        <Property Name="lastLogSummary" Type="Edm.String"/>
        <Property Name="lastLogStatus" Type="Edm.String"/>
      </EntityType>
      <EntityType Name="Subscription">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="userId" Type="Edm.String"/>
        <Property Name="planId" Type="Edm.String"/>
        <Property Name="status" Type="Edm.String"/>
        <Property Name="periodEnd" Type="Edm.DateTimeOffset"/>
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityType Name="Overview">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.String" Nullable="false"/>
        <Property Name="totalUsers" Type="Edm.Int64"/>
        <Property Name="totalBusinesses" Type="Edm.Int64"/>
        <Property Name="totalUsageEvents" Type="Edm.Int64"/>
        <Property Name="totalRevenuePence" Type="Edm.Int64"/>
        <Property Name="totalWalletBalancePence" Type="Edm.Int64"/>
        <Property Name="totalAgents" Type="Edm.Int64"/>
        <Property Name="totalSubscriptions" Type="Edm.Int64"/>
        <Property Name="asOf" Type="Edm.DateTimeOffset"/>
      </EntityType>
      <EntityContainer Name="GoRigoAnalytics">
        <EntitySet Name="users" EntityType="GoRigo.Analytics.User"/>
        <EntitySet Name="businesses" EntityType="GoRigo.Analytics.Business"/>
        <EntitySet Name="usage" EntityType="GoRigo.Analytics.UsageEvent"/>
        <EntitySet Name="revenue" EntityType="GoRigo.Analytics.WalletTransaction"/>
        <EntitySet Name="agents" EntityType="GoRigo.Analytics.Agent"/>
        <EntitySet Name="subscriptions" EntityType="GoRigo.Analytics.Subscription"/>
        <Singleton Name="overview" Type="GoRigo.Analytics.Overview"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
});

router.get("/users", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(usersTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in usersTable ? usersTable[orderField as keyof typeof usersTable] : usersTable.createdAt) as Column;

    const [rows, wallets, subs] = await Promise.all([
      db
        .select()
        .from(usersTable)
        .where(dateFilter)
        .orderBy(orderClause(sortCol, orderDir))
        .limit(top)
        .offset(skip),
      db.select().from(walletsTable),
      db.select().from(userSubscriptionsTable),
    ]);

    const walletMap = new Map(wallets.map((w) => [w.userId, w.balancePence]));
    const subMap = new Map(subs.map((s) => [s.userId, { planId: s.planId, status: s.status }]));

    res.json({
      "@odata.context": odataContext("users"),
      value: rows.map((u) => ({
        id: u.id,
        platform: u.platform,
        email: u.email ?? null,
        emailVerified: u.emailVerified,
        suspended: u.suspended,
        walletBalancePence: walletMap.get(u.id) ?? 0,
        planId: subMap.get(u.id)?.planId ?? "free",
        subscriptionStatus: subMap.get(u.id)?.status ?? "unknown",
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/businesses", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(businessesTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in businessesTable ? businessesTable[orderField as keyof typeof businessesTable] : businessesTable.createdAt) as Column;

    const rows = await db
      .select()
      .from(businessesTable)
      .where(dateFilter)
      .orderBy(orderClause(sortCol, orderDir))
      .limit(top)
      .offset(skip);

    res.json({
      "@odata.context": odataContext("businesses"),
      value: rows.map((b) => ({
        id: b.id,
        userId: b.userId,
        name: b.name,
        sector: b.sector ?? null,
        country: b.country,
        accountType: b.accountType ?? null,
        intent: b.intent ?? null,
        isActive: b.isActive,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/usage", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(usageEventsTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in usageEventsTable ? usageEventsTable[orderField as keyof typeof usageEventsTable] : usageEventsTable.createdAt) as Column;

    const rows = await db
      .select()
      .from(usageEventsTable)
      .where(dateFilter)
      .orderBy(orderClause(sortCol, orderDir))
      .limit(top)
      .offset(skip);

    res.json({
      "@odata.context": odataContext("usage"),
      value: rows.map((e) => {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        return {
          id: e.id,
          userId: e.userId,
          businessId: e.businessId,
          eventType: e.eventType,
          tokensConsumed: typeof meta["tokensConsumed"] === "number" ? meta["tokensConsumed"] :
                          typeof meta["tokenCount"] === "number" ? meta["tokenCount"] :
                          typeof meta["tokens"] === "number" ? meta["tokens"] : null,
          createdAt: e.createdAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/revenue", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(walletTransactionsTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in walletTransactionsTable ? walletTransactionsTable[orderField as keyof typeof walletTransactionsTable] : walletTransactionsTable.createdAt) as Column;

    const rows = await db
      .select()
      .from(walletTransactionsTable)
      .where(dateFilter)
      .orderBy(orderClause(sortCol, orderDir))
      .limit(top)
      .offset(skip);

    res.json({
      "@odata.context": odataContext("revenue"),
      value: rows.map((t) => ({
        id: t.id,
        userId: t.userId,
        type: t.type,
        amountPence: t.amountPence,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/agents", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(agentsTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in agentsTable ? agentsTable[orderField as keyof typeof agentsTable] : agentsTable.createdAt) as Column;

    const [agents, latestLogs] = await Promise.all([
      db
        .select()
        .from(agentsTable)
        .where(dateFilter)
        .orderBy(orderClause(sortCol, orderDir))
        .limit(top)
        .offset(skip),
      db
        .select()
        .from(agentLogsTable)
        .orderBy(desc(agentLogsTable.createdAt))
        .limit(1000),
    ]);

    const latestLogMap = new Map<string, typeof latestLogs[0]>();
    for (const log of latestLogs) {
      if (!latestLogMap.has(log.agentId)) {
        latestLogMap.set(log.agentId, log);
      }
    }

    res.json({
      "@odata.context": odataContext("agents"),
      value: agents.map((a) => {
        const log = latestLogMap.get(a.id);
        return {
          id: a.id,
          userId: a.userId,
          businessId: a.businessId,
          name: a.name,
          type: a.type,
          scheduleType: a.scheduleType,
          isActive: a.isActive,
          lastRunAt: a.lastRunAt?.toISOString() ?? null,
          nextRunAt: a.nextRunAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          lastLogSummary: log?.summary ?? null,
          lastLogStatus: log ? "completed" : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/subscriptions", requireEntraAuth, async (req, res, next) => {
  try {
    const { top, skip, filterFrom, filterTo, orderField, orderDir } = parseODataParams(
      req.query as Record<string, unknown>,
    );
    const dateFilter = buildDateFilter(userSubscriptionsTable.createdAt, filterFrom, filterTo);
    const sortCol = (orderField in userSubscriptionsTable ? userSubscriptionsTable[orderField as keyof typeof userSubscriptionsTable] : userSubscriptionsTable.createdAt) as Column;

    const rows = await db
      .select()
      .from(userSubscriptionsTable)
      .where(dateFilter)
      .orderBy(orderClause(sortCol, orderDir))
      .limit(top)
      .offset(skip);

    res.json({
      "@odata.context": odataContext("subscriptions"),
      value: rows.map((s) => ({
        id: s.id,
        userId: s.userId,
        planId: s.planId,
        status: s.status,
        periodEnd: s.periodEnd.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/overview", requireEntraAuth, async (_req, res, next) => {
  try {
    const [
      users,
      businesses,
      events,
      revenue,
      wallets,
      agents,
      subscriptions,
    ] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable),
      db.select({ cnt: count() }).from(businessesTable),
      db.select({ cnt: count() }).from(usageEventsTable),
      db.select({ total: sum(walletTransactionsTable.amountPence) }).from(walletTransactionsTable),
      db.select({ total: sum(walletsTable.balancePence) }).from(walletsTable),
      db.select({ cnt: count() }).from(agentsTable),
      db.select({ cnt: count() }).from(userSubscriptionsTable),
    ]);

    res.json({
      "@odata.context": odataContext("overview"),
      id: "singleton",
      totalUsers: Number(users[0]?.cnt ?? 0),
      totalBusinesses: Number(businesses[0]?.cnt ?? 0),
      totalUsageEvents: Number(events[0]?.cnt ?? 0),
      totalRevenuePence: Number(revenue[0]?.total ?? 0),
      totalWalletBalancePence: Number(wallets[0]?.total ?? 0),
      totalAgents: Number(agents[0]?.cnt ?? 0),
      totalSubscriptions: Number(subscriptions[0]?.cnt ?? 0),
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
