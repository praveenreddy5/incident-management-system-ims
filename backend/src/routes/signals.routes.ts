import { Router } from "express";
import { signalSchema } from "../models/signal.schema";
import { ingestionRateLimit } from "../middlewares/rateLimit";
import { enqueueSignal } from "../services/queue";
import { markSignalAccepted } from "../services/throughput.service";
import { log } from "../services/logger";

export const signalsRouter = Router();

signalsRouter.post("/", ingestionRateLimit, async (req, res) => {
  const parsed = signalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: parsed.error.flatten(),
    });
  }

  const traceId = req.context?.traceId || parsed.data.trace_id || "unknown-trace";
  try {
    await enqueueSignal({ ...parsed.data, trace_id: traceId });
    markSignalAccepted();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue signal";
    if (error instanceof Error && error.name === "BackpressureError") {
      return res.status(503).json({
        error: "Backpressure active, retry later",
        traceId,
      });
    }
    if (error instanceof Error && error.name === "QueueUnavailableError") {
      log("WARN", "Queue unavailable during ingestion", { traceId, error: message });
      return res.status(503).json({
        error: "Ingestion queue unavailable, retry later",
        traceId,
      });
    }
    log("ERROR", "Signal enqueue failed", { traceId, error: message });
    return res.status(500).json({ error: "Failed to ingest signal", traceId });
  }

  return res.status(202).json({
    status: "accepted",
    queued: true,
    traceId,
  });
});