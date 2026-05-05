import { WorkItemState } from "@prisma/client";

const allowed: Record<WorkItemState, WorkItemState[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: WorkItemState, to: WorkItemState): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function rcaComplete(
  rca:
    | {
        incidentStart: Date;
        incidentEnd: Date;
        rootCauseCategory: string;
        fixApplied: string;
        preventionSteps: string;
      }
    | null
    | undefined
): boolean {
  if (!rca) return false;
  return (
    !!rca.rootCauseCategory?.trim() &&
    !!rca.fixApplied?.trim() &&
    !!rca.preventionSteps?.trim() &&
    rca.incidentStart instanceof Date &&
    rca.incidentEnd instanceof Date
  );
}

export function mttrMinutes(firstSignalAt: Date, incidentEnd: Date): number {
  const ms = incidentEnd.getTime() - firstSignalAt.getTime();
  return Math.max(0, Math.round(ms / 60000));
}