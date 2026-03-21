import { Router } from "express";
import { db } from "@workspace/db";
import { usageEventsTable, agentLogsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req, res, next) => {
  try {
    const { businessId, startDate, endDate } = req.query;
    if (!businessId || !startDate || !endDate) {
      res.status(400).json({ error: "businessId, startDate, and endDate required" });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    const [eventsResult, agentLogsResult] = await Promise.all([
      db
        .select({ cnt: count() })
        .from(usageEventsTable)
        .where(
          and(
            eq(usageEventsTable.userId, req.userId!),
            eq(usageEventsTable.businessId, businessId as string),
            gte(usageEventsTable.createdAt, start),
            lte(usageEventsTable.createdAt, end),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(agentLogsTable)
        .where(
          and(
            eq(agentLogsTable.userId, req.userId!),
            eq(agentLogsTable.businessId, businessId as string),
            gte(agentLogsTable.createdAt, start),
            lte(agentLogsTable.createdAt, end),
          ),
        ),
    ]);

    res.json({
      agentRuns: Number(agentLogsResult[0]?.cnt ?? 0),
      communications: 0,
      eventsUsed: Number(eventsResult[0]?.cnt ?? 0),
      conversations: 0,
      period: { start: start.toISOString(), end: end.toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
