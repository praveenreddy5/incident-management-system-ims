import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { bullRedis } from "../config/redis";
import type { SignalInput } from "../models/signal.schema";

export const SIGNAL_QUEUE_NAME = "signal-ingestion";
export const SIGNAL_DLQ_NAME = "signal-ingestion-dlq";
const MAX_WAITING_JOBS = Number(process.env.MAX_WAITING_JOBS || 25000);

export const signalQueue = new Queue<SignalInput>(SIGNAL_QUEUE_NAME, {
  connection: bullRedis,
});

export const signalDlq = new Queue<SignalInput>(SIGNAL_DLQ_NAME, {
  connection: bullRedis,
});

export async function enqueueSignal(signal: SignalInput): Promise<void> {
  let waitingJobs = 0;
  try {
    const queueCounts = await signalQueue.getJobCounts("waiting", "active", "delayed");
    waitingJobs =
      (queueCounts.waiting ?? 0) +
      (queueCounts.active ?? 0) +
      (queueCounts.delayed ?? 0);
  } catch (error) {
    const unavailable = new Error(
      `Queue unavailable: ${error instanceof Error ? error.message : "unknown"}`
    );
    unavailable.name = "QueueUnavailableError";
    throw unavailable;
  }

  if (waitingJobs >= MAX_WAITING_JOBS) {
    const error = new Error("Ingestion backlog threshold reached");
    error.name = "BackpressureError";
    throw error;
  }

  const jobId = signal.signal_id || buildStableSignalId(signal);
  try {
    await signalQueue.add("ingest-signal", signal, {
      jobId,
      removeOnComplete: 1000,
      removeOnFail: false,
      attempts: 5,
      backoff: { type: "exponential", delay: 500 },
    });
  } catch (error) {
    const unavailable = new Error(
      `Queue unavailable: ${error instanceof Error ? error.message : "unknown"}`
    );
    unavailable.name = "QueueUnavailableError";
    throw unavailable;
  }
}

function buildStableSignalId(signal: SignalInput): string {
  const stable = `${signal.component_id}|${signal.component_type}|${signal.message}|${signal.timestamp}`;
  return createHash("sha256").update(stable).digest("hex");
}