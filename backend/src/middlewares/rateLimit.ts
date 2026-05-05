import type { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis";

const WINDOW_SECONDS = 1;
const MAX_REQUESTS = Number(process.env.INGESTION_MAX_RPS || 200);

export async function ingestionRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ip = req.ip || "unknown";
    const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_REQUESTS) {
      res.setHeader("Retry-After", String(WINDOW_SECONDS));
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    next();
  } catch {
    // fail-open so ingestion does not fully stop
    next();
  }
}