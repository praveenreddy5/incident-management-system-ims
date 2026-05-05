import { Router } from "express";
import { prisma } from "../config/prisma";
import { RawSignalModel } from "../models/rawSignal.model";
import { Prisma, Severity, WorkItemState } from "@prisma/client";
import { rcaBodySchema } from "../models/rca.schema";
import {
  canTransition,
  mttrMinutes,
  rcaComplete,
} from "../services/workitem.workflow";
import {
  readActiveIncidentsFromCache,
  invalidateActiveIncidentsCache,
  writeActiveIncidentsToCache,
} from "../services/dashboardCache.service";
import { withRetry } from "../services/retry.service";
import { log } from "../services/logger";
import { signalDlq, signalQueue } from "../services/queue";

export const incidentsRouter = Router();

const severityRank: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

// GET /incidents/ops/queue
incidentsRouter.get("/ops/queue", async (_req, res) => {
  if (!_req.context || _req.context.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }

  const [mainCounts, dlqCounts] = await Promise.all([
    signalQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    signalDlq.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
  ]);

  return res.json({ mainQueue: mainCounts, deadLetterQueue: dlqCounts });
});

// GET /incidents/active
incidentsRouter.get("/active", async (_req, res) => {
  const page = Math.max(1, Number(_req.query.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Number(_req.query.pageSize ?? 25)));
  const severity = String(_req.query.severity ?? "").trim().toUpperCase();
  const componentId = String(_req.query.componentId ?? "").trim();
  const state = String(_req.query.state ?? "").trim().toUpperCase();
  const validStates = new Set(["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"]);
  const validSeverities = new Set(["P0", "P1", "P2", "P3"]);
  if (state && !validStates.has(state)) {
    return res.status(400).json({ error: "Invalid state filter" });
  }
  if (severity && !validSeverities.has(severity)) {
    return res.status(400).json({ error: "Invalid severity filter" });
  }
  const groupByComponent =
    String(_req.query.groupByComponent ?? "true").toLowerCase() !== "false";
  const queryHasFilters = Boolean(severity || componentId || state);

  const where: Prisma.WorkItemWhereInput = {
    state: state
      ? (state as WorkItemState)
      : {
          in: [
            WorkItemState.OPEN,
            WorkItemState.INVESTIGATING,
            WorkItemState.RESOLVED,
          ],
        },
    ...(severity ? { severity: severity as Severity } : {}),
    ...(componentId ? { componentId: { contains: componentId } } : {}),
  };

  if (groupByComponent) {
    if (!queryHasFilters) {
      const cachedGrouped = await readActiveIncidentsFromCache();
      if (cachedGrouped && cachedGrouped.length > 0) {
        const total = cachedGrouped.length;
        const items = cachedGrouped.slice((page - 1) * pageSize, page * pageSize);
        return res.json({
          items,
          source: "cache",
          pagination: { page, pageSize, total },
          groupedByComponent: true,
          datastore: "redis",
        });
      }
    }
    const all = await withRetry(() =>
      prisma.workItem.findMany({
        where,
        include: { rca: true },
        orderBy: [{ updatedAt: "desc" }],
      })
    );
    const byComponent = new Map<string, (typeof all)[number]>();
    for (const incident of all) {
      if (!byComponent.has(incident.componentId)) {
        byComponent.set(incident.componentId, incident);
      }
    }
    const deduped = Array.from(byComponent.values()).sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    if (!queryHasFilters) {
      await writeActiveIncidentsToCache(deduped);
    }
    const total = deduped.length;
    const items = deduped.slice((page - 1) * pageSize, page * pageSize);
    return res.json({
      items,
      source: "db",
      pagination: { page, pageSize, total },
      groupedByComponent: true,
      datastore: "postgres",
    });
  }

  const incidents = await withRetry(() =>
    prisma.workItem.findMany({
      where,
      include: { rca: true },
      orderBy: [{ severity: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
  );
  const total = await withRetry(() => prisma.workItem.count({ where }));

  if (!queryHasFilters && page === 1 && pageSize === 25) {
    await writeActiveIncidentsToCache(incidents);
  }

  return res.json({
    items: incidents,
    source: "db",
    pagination: { page, pageSize, total },
    groupedByComponent: false,
    datastore: "postgres",
  });
});

// PATCH /incidents/:id/state
incidentsRouter.patch("/:id/state", async (req, res) => {
  if (!req.context || (req.context.role !== "operator" && req.context.role !== "admin")) {
    return res.status(403).json({ error: "Operator or admin role required" });
  }

  const { id } = req.params;
  const nextState = req.body?.state as WorkItemState;

  if (!nextState || !Object.values(WorkItemState).includes(nextState)) {
    return res.status(400).json({ error: "Invalid state" });
  }

  const existing = await withRetry(() =>
    prisma.workItem.findUnique({
      where: { id },
      include: { rca: true },
    })
  );

  if (!existing) {
    return res.status(404).json({ error: "Incident not found" });
  }

  if (!canTransition(existing.state, nextState)) {
    return res.status(400).json({
      error: `Cannot transition ${existing.state} -> ${nextState}`,
    });
  }

  if (nextState === WorkItemState.CLOSED && !rcaComplete(existing.rca)) {
    return res.status(400).json({
      error: "Cannot close without complete RCA",
    });
  }

  const updated = await withRetry(() =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const endingTransition =
        nextState === WorkItemState.RESOLVED || nextState === WorkItemState.CLOSED;
      const incidentEndAt = endingTransition ? existing.endedAt ?? now : existing.endedAt;

      return tx.workItem.update({
        where: { id },
        data: {
          state: nextState,
          ...(endingTransition ? { endedAt: incidentEndAt } : {}),
        },
        include: { rca: true },
      });
    })
  );
  await invalidateActiveIncidentsCache();

  return res.json({ incident: updated });
});

// POST /incidents/:id/rca
incidentsRouter.post("/:id/rca", async (req, res) => {
  if (!req.context || (req.context.role !== "operator" && req.context.role !== "admin")) {
    return res.status(403).json({ error: "Operator or admin role required" });
  }

  const { id } = req.params;

  const parsed = rcaBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid RCA payload",
      details: parsed.error.flatten(),
    });
  }

  const workItem = await withRetry(() =>
    prisma.workItem.findUnique({ where: { id }, include: { rca: true } })
  );
  if (!workItem) {
    return res.status(404).json({ error: "Incident not found" });
  }

  const start = new Date(parsed.data.incidentStart);
  const end = new Date(parsed.data.incidentEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return res.status(400).json({ error: "Invalid incidentStart/incidentEnd" });
  }

  const submittedAt = new Date();
  // Assignment definition: MTTR uses first signal as start and RCA submission as end.
  const minutes = mttrMinutes(workItem.firstSignalAt, submittedAt);

  const saved = await withRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.rCA.upsert({
        where: { workItemId: id },
        create: {
          workItemId: id,
          incidentStart: start,
          incidentEnd: end,
          submittedAt,
          rootCauseCategory: parsed.data.rootCauseCategory,
          fixApplied: parsed.data.fixApplied,
          preventionSteps: parsed.data.preventionSteps,
        },
        update: {
          incidentStart: start,
          incidentEnd: end,
          submittedAt,
          rootCauseCategory: parsed.data.rootCauseCategory,
          fixApplied: parsed.data.fixApplied,
          preventionSteps: parsed.data.preventionSteps,
        },
      });

      return tx.workItem.update({
        where: { id },
        data: { mttrMinutes: minutes },
        include: { rca: true },
      });
    })
  );
  await invalidateActiveIncidentsCache();

  return res.status(201).json({ incident: saved });
});

// GET /incidents/aggregations/timeseries
incidentsRouter.get("/aggregations/timeseries", async (req, res) => {
  const windowMinutes = Math.max(5, Math.min(24 * 60, Number(req.query.minutes ?? 60)));
  const from = new Date(Date.now() - windowMinutes * 60000);
  const componentId = String(req.query.componentId ?? "").trim();

  const buckets = await RawSignalModel.aggregate([
    {
      $match: {
        received_at: { $gte: from },
        ...(componentId ? { component_id: componentId } : {}),
      },
    },
    {
      $group: {
        _id: {
          y: { $year: "$received_at" },
          m: { $month: "$received_at" },
          d: { $dayOfMonth: "$received_at" },
          h: { $hour: "$received_at" },
          min: { $minute: "$received_at" },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1, "_id.h": 1, "_id.min": 1 } },
  ]);

  const points = buckets.map((bucket) => {
    const date = new Date(
      bucket._id.y,
      bucket._id.m - 1,
      bucket._id.d,
      bucket._id.h,
      bucket._id.min
    );
    return {
      minute: date.toISOString(),
      count: bucket.count as number,
    };
  });

  return res.json({ windowMinutes, componentId: componentId || null, points });
});

// GET /incidents/stream
incidentsRouter.get("/stream", async (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const interval = setInterval(async () => {
    try {
      const incidents = await prisma.workItem.findMany({
        where: {
          state: {
            in: ["OPEN", "INVESTIGATING", "RESOLVED"],
          },
        },
        orderBy: { updatedAt: "desc" },
      });
      const byComponent = new Map<string, (typeof incidents)[number]>();
      for (const incident of incidents) {
        if (!byComponent.has(incident.componentId)) {
          byComponent.set(incident.componentId, incident);
        }
      }
      const grouped = Array.from(byComponent.values()).sort(
        (a, b) =>
          severityRank[a.severity] - severityRank[b.severity] ||
          b.updatedAt.getTime() - a.updatedAt.getTime()
      );

      res.write(`event: active_incidents\n`);
      res.write(
        `data: ${JSON.stringify({
          items: grouped.slice(0, 100),
          total: grouped.length,
        })}\n\n`
      );
    } catch (error) {
      log("ERROR", "Failed SSE publish", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }, 3000);

  _req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

// GET /incidents/:id
incidentsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize ?? 50)));
  if (!id) {
    return res.status(400).json({ error: "Incident id is required" });
  }

  const incidentQuery: Prisma.WorkItemFindUniqueArgs = {
    where: { id },
    include: { rca: true },
  };
  log("INFO", "Incident detail lookup", {
    requestedId: id,
    query: {
      where: incidentQuery.where,
      include: incidentQuery.include,
      page,
      pageSize,
    },
    datastore: "postgres",
  });

  const incident = await withRetry(() =>
    prisma.workItem.findUnique(incidentQuery)
  );
  const incidentResultCount = incident ? 1 : 0;
  log("INFO", "Incident detail lookup result", {
    requestedId: id,
    resultCount: incidentResultCount,
  });

  if (!incident) {
    return res.status(404).json({ error: "Incident not found" });
  }

  const rawSignals = await RawSignalModel.find({ work_item_id: id })
    .sort({ received_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  const totalSignals = await RawSignalModel.countDocuments({ work_item_id: id });

  return res.json({
    incident,
    rawSignals,
    pagination: { page, pageSize, total: totalSignals },
    datastore: "postgres",
  });
});