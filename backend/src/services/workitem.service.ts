import { WorkItemState } from "@prisma/client";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { alertStrategy } from "../strategies/alertStrategy";
import { withRetry } from "./retry.service";
import { invalidateActiveIncidentsCache } from "./dashboardCache.service";

const WINDOW_SECONDS = 10;
const LOCK_SECONDS = 3;

export async function getOrCreateWorkItem(
  componentId: string,
  componentType: string,
  signalTime: Date
): Promise<string> {
  const key = `debounce:${componentId}`;
  const lockKey = `debounce-lock:${componentId}`;
  const existingWorkItemId = await redis.get(key);

  if (existingWorkItemId) {
    await withRetry(() =>
      prisma.workItem.update({
        where: { id: existingWorkItemId },
        data: {
          signalCount: { increment: 1 },
          lastSignalAt: signalTime,
        },
      })
    );
    await invalidateActiveIncidentsCache();
    return existingWorkItemId;
  }

  const lockAcquired = Boolean(
    await redis.set(lockKey, "1", "EX", LOCK_SECONDS, "NX")
  );
  if (!lockAcquired) {
    await sleep(50);
    const shortlyAfter = await redis.get(key);
    if (shortlyAfter) {
      await withRetry(() =>
        prisma.workItem.update({
          where: { id: shortlyAfter },
          data: {
            signalCount: { increment: 1 },
            lastSignalAt: signalTime,
          },
        })
      );
      await invalidateActiveIncidentsCache();
      return shortlyAfter;
    }
  }

  const severity = alertStrategy.getSeverity(componentType);

  try {
    const created = await withRetry(() =>
      prisma.workItem.create({
        data: {
          componentId,
          componentType,
          title: `${componentType} incident on ${componentId}`,
          severity,
          state: WorkItemState.OPEN,
          firstSignalAt: signalTime,
          lastSignalAt: signalTime,
          signalCount: 1,
        },
      })
    );

    await redis.set(key, created.id, "EX", WINDOW_SECONDS);
    await invalidateActiveIncidentsCache();
    return created.id;
  } finally {
    if (lockAcquired) {
      await redis.del(lockKey);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}