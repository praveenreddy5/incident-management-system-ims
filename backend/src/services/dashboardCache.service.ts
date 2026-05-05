import { redis } from "../config/redis";
import type { RCA, WorkItem } from "@prisma/client";

const ACTIVE_INCIDENTS_KEY = "dashboard:active-incidents:v1";
const ACTIVE_INCIDENTS_TTL_SECONDS = 5;
type DashboardIncident = WorkItem & { rca?: RCA | null };

export async function readActiveIncidentsFromCache(): Promise<DashboardIncident[] | null> {
  const raw = await redis.get(ACTIVE_INCIDENTS_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DashboardIncident[];
  } catch {
    return null;
  }
}

export async function writeActiveIncidentsToCache(items: DashboardIncident[]): Promise<void> {
  await redis.set(
    ACTIVE_INCIDENTS_KEY,
    JSON.stringify(items),
    "EX",
    ACTIVE_INCIDENTS_TTL_SECONDS
  );
}

export async function invalidateActiveIncidentsCache(): Promise<void> {
  await redis.del(ACTIVE_INCIDENTS_KEY);
}
