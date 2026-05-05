import { Worker } from "bullmq";
import { bullRedis } from "../config/redis";
import { SIGNAL_DLQ_NAME, SIGNAL_QUEUE_NAME, signalDlq } from "../services/queue";
import { RawSignalModel } from "../models/rawSignal.model";
import type { SignalInput } from "../models/signal.schema";
import { getOrCreateWorkItem } from "../services/workitem.service";
import { withRetry } from "../services/retry.service";
import {
  markProcessingLatency,
  markSignalFailed,
  markSignalRetried,
} from "../services/throughput.service";
import { log } from "../services/logger";

let worker: Worker<SignalInput> | null = null;

export function startSignalWorker(): Worker<SignalInput> {
  if (worker) return worker;

  worker = new Worker<SignalInput>(
    SIGNAL_QUEUE_NAME,
    async (job) => {
      const startedAt = Date.now();
      const signal = job.data;
      const signalTime = new Date(signal.timestamp);

      
      const workItemId = await getOrCreateWorkItem(
        signal.component_id,
        signal.component_type,
        signalTime
      );

      
      await withRetry(() =>
        RawSignalModel.create({
          signal_id: String(job.id),
          component_id: signal.component_id,
          component_type: signal.component_type,
          message: signal.message,
          timestamp: signal.timestamp,
          metadata: signal.metadata,
          work_item_id: workItemId,
          trace_id: signal.trace_id,
        })
      );

      markProcessingLatency(Date.now() - startedAt);
    },
    {
      connection: bullRedis,
      concurrency: 20,
    }
  );

  worker.on("completed", (job) => {
    log("INFO", "Worker completed job", {
      queue: SIGNAL_QUEUE_NAME,
      jobId: job.id,
    });
  });

  worker.on("active", (job) => {
    if ((job.attemptsStarted ?? 0) > 1) {
      markSignalRetried();
    }
  });

  worker.on("failed", async (job, err) => {
    markSignalFailed();
    log("ERROR", "Worker failed job", {
      queue: SIGNAL_QUEUE_NAME,
      dlq: SIGNAL_DLQ_NAME,
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      reason: err.message,
    });

    if (job && job.attemptsMade >= 5) {
      await signalDlq.add("dead-letter-signal", job.data, {
        removeOnComplete: 500,
        removeOnFail: 500,
      });
    }
  });

  return worker;
}