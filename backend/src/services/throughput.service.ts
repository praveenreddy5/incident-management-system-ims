import { WorkItemState } from "@prisma/client";
import { prisma } from "../config/prisma";
import { signalQueue } from "./queue";

let acceptedSignals = 0;
let metricsStarted = false;
let failedSignals = 0;
let retriedSignals = 0;
const processingLatencyMs: number[] = [];

export function markSignalAccepted(): void {
  acceptedSignals += 1;
}

export function markSignalFailed(): void {
  failedSignals += 1;
}

export function markSignalRetried(): void {
  retriedSignals += 1;
}

export function markProcessingLatency(latencyMs: number): void {
  processingLatencyMs.push(latencyMs);
  if (processingLatencyMs.length > 1000) {
    processingLatencyMs.shift();
  }
}

export function startThroughputLogger(): void {
  if (metricsStarted) return;
  metricsStarted = true;

  setInterval(async () => {
    try {
      const queueCounts = await signalQueue.getJobCounts(
        "waiting",
        "active",
        "delayed"
      );
      const queueSize =
        (queueCounts.waiting ?? 0) +
        (queueCounts.active ?? 0) +
        (queueCounts.delayed ?? 0);
      const activeIncidents = await prisma.workItem.count({
        where: {
          state: {
            in: [
              WorkItemState.OPEN,
              WorkItemState.INVESTIGATING,
              WorkItemState.RESOLVED,
            ],
          },
        },
      });
      const { p95, p99 } = percentiles(processingLatencyMs);
      const errorRate = acceptedSignals > 0
        ? (failedSignals / Math.max(acceptedSignals, 1)) * 100
        : 0;

      console.log(
        `[metrics] signals/sec=${(acceptedSignals / 5).toFixed(2)} queue_size=${queueSize} active_incidents=${activeIncidents} errors=${failedSignals} retries=${retriedSignals} error_rate_pct=${errorRate.toFixed(2)} p95_ms=${p95} p99_ms=${p99}`
      );
    } catch (error) {
      console.error("[metrics] failed to collect metrics", error);
    } finally {
      acceptedSignals = 0;
      failedSignals = 0;
      retriedSignals = 0;
      processingLatencyMs.length = 0;
    }
  }, 5000);
}

function percentiles(values: number[]): { p95: number; p99: number } {
  if (values.length === 0) return { p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  return { p95, p99 };
}
