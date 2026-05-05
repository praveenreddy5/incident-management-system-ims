import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { signalsRouter } from "./routes/signals.routes";
import { incidentsRouter } from "./routes/incidents.routes";
import { requestContext } from "./middlewares/requestContext";
import { requireRole } from "./middlewares/auth";
import { log } from "./services/logger";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(requestContext);

app.get("/health", async (_req, res) => {
  let postgres = "down";
  let mongo = "down";
  let redisStatus = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    postgres = "up";
  } catch {
    postgres = "down";
  }

  mongo = mongoose.connection.readyState === 1 ? "up" : "down";

  try {
    const pong = await redis.ping();
    redisStatus = pong === "PONG" ? "up" : "down";
  } catch {
    redisStatus = "down";
  }

  const allUp =
    postgres === "up" && mongo === "up" && redisStatus === "up";

  if (!allUp) {
    log("WARN", "Health degraded", {
      postgres,
      mongo,
      redis: redisStatus,
    });
  }

  res.status(allUp ? 200 : 503).json({
    status: allUp ? "ok" : "degraded",
    service: "incident-management-backend",
    timestamp: new Date().toISOString(),
    dependencies: {
      postgres,
      mongo,
      redis: redisStatus,
    },
  });
});

app.use("/signals", requireRole("viewer"), signalsRouter);
app.use("/incidents", requireRole("viewer"), incidentsRouter);
