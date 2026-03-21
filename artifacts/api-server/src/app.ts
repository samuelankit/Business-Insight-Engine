import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { logger } from "./lib/logger.js";
import router from "./routes/index.js";

const app: Express = express();

// Trust the Replit reverse proxy — required for express-rate-limit to work correctly
app.set("trust proxy", 1);

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));

// ── Logging ───────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Rate limiting (fix: tiered limits per endpoint category) ──────────────
const make = (max: number) =>
  rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded, please slow down." },
  });

app.use("/api/auth", make(10));
app.use("/api/orchestrate", make(20));
app.use("/api/transcribe", make(20));
app.use("/api/tts", make(20));
app.use("/api/agents/:id/run", make(20));
app.use("/api/webhooks", make(200));
app.use("/api", make(100));

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, "Unhandled error");
    const isDev = process.env["NODE_ENV"] !== "production";
    res.status(500).json({ error: isDev ? err.message : "Internal server error" });
  },
);

export default app;
