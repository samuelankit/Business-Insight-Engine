import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, businessesTable, usageEventsTable, userTokensTable, walletsTable, walletTransactionsTable } from "@workspace/db/schema";
import { count, desc, eq, and, gt } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";

const router = Router();

router.get("/check", async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      res.json({ isAdmin: false });
      return;
    }

    const adminToken = process.env["ADMIN_TOKEN"];
    if (adminToken && token === adminToken) {
      res.json({ isAdmin: true });
      return;
    }

    const [row] = await db
      .select({ userId: userTokensTable.userId })
      .from(userTokensTable)
      .where(and(eq(userTokensTable.token, token), gt(userTokensTable.expiresAt, new Date())))
      .limit(1);

    if (!row) {
      res.json({ isAdmin: false });
      return;
    }

    const [user] = await db
      .select({ isAdminUser: usersTable.isAdminUser, suspended: usersTable.suspended })
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);

    res.json({ isAdmin: !!(user && !user.suspended && user.isAdminUser) });
  } catch (err) {
    next(err);
  }
});

router.get("/overview", requireAdmin, async (_req, res, next) => {
  try {
    const [users, businesses, events] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable),
      db.select({ cnt: count() }).from(businessesTable),
      db.select({ cnt: count() }).from(usageEventsTable),
    ]);

    res.json({
      totalUsers: Number(users[0]?.cnt ?? 0),
      activeUsers7d: 0,
      activeUsers30d: 0,
      totalBusinesses: Number(businesses[0]?.cnt ?? 0),
      totalEvents: Number(events[0]?.cnt ?? 0),
      totalCommunications: 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const offset = (page - 1) * limit;

    const [users, total] = await Promise.all([
      db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset),
      db.select({ cnt: count() }).from(usersTable),
    ]);

    res.json({
      users: users.map((u) => ({ id: u.id, deviceId: `${u.deviceId.slice(0, 6)}...`, suspended: u.suspended, createdAt: u.createdAt.toISOString() })),
      total: Number(total[0]?.cnt ?? 0),
      page,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/revenue", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ dailyTotals: [], subscriptionRevenuePence: 0, walletRevenuePence: 0 });
  } catch (err) {
    next(err);
  }
});

router.get("/health", requireAdmin, async (_req, res, next) => {
  try {
    const memUsage = process.memoryUsage();
    res.json({
      db: "ok",
      uptime: process.uptime(),
      memoryMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      poolActive: 0,
      poolIdle: 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/wallets", requireAdmin, async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const offset = (page - 1) * limit;

    const [wallets, total] = await Promise.all([
      db.select().from(walletsTable).orderBy(desc(walletsTable.updatedAt)).limit(limit).offset(offset),
      db.select({ cnt: count() }).from(walletsTable),
    ]);

    res.json({
      wallets: wallets.map((w) => ({
        id: w.id,
        userId: w.userId,
        balancePence: w.balancePence,
        balanceFormatted: `£${(w.balancePence / 100).toFixed(2)}`,
        updatedAt: w.updatedAt?.toISOString() ?? null,
      })),
      total: Number(total[0]?.cnt ?? 0),
      page,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/wallets/:userId/transactions", requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 50);
    const offset = (page - 1) * limit;

    const [wallet] = await db
      .select()
      .from(walletsTable)
      .where(eq(walletsTable.userId, userId!))
      .limit(1);

    if (!wallet) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const [transactions, total] = await Promise.all([
      db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, userId!))
        .orderBy(desc(walletTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ cnt: count() })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, userId!)),
    ]);

    res.json({
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        balancePence: wallet.balancePence,
        balanceFormatted: `£${(wallet.balancePence / 100).toFixed(2)}`,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amountPence: t.amountPence,
        amountFormatted: `£${(t.amountPence / 100).toFixed(2)}`,
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt?.toISOString() ?? null,
      })),
      total: Number(total[0]?.cnt ?? 0),
      page,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
