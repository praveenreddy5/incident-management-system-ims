import { describe, expect, it } from "vitest";
import {
  canTransition,
  mttrMinutes,
  rcaComplete,
} from "../src/services/workitem.workflow";

describe("workitem workflow", () => {
  it("allows only valid state transitions", () => {
    expect(canTransition("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransition("OPEN", "RESOLVED")).toBe(false);
    expect(canTransition("CLOSED", "OPEN")).toBe(false);
  });

  it("rejects incomplete RCA payload", () => {
    expect(rcaComplete(null)).toBe(false);
    expect(
      rcaComplete({
        incidentStart: new Date("2026-04-30T12:00:00.000Z"),
        incidentEnd: new Date("2026-04-30T12:10:00.000Z"),
        rootCauseCategory: "",
        fixApplied: "Restarted replica",
        preventionSteps: "Added alert threshold",
      })
    ).toBe(false);
  });

  it("accepts complete RCA payload", () => {
    expect(
      rcaComplete({
        incidentStart: new Date("2026-04-30T12:00:00.000Z"),
        incidentEnd: new Date("2026-04-30T12:10:00.000Z"),
        rootCauseCategory: "Capacity",
        fixApplied: "Scaled read replicas",
        preventionSteps: "Capacity plan updates",
      })
    ).toBe(true);
  });

  it("calculates non-negative MTTR", () => {
    expect(
      mttrMinutes(
        new Date("2026-04-30T12:00:00.000Z"),
        new Date("2026-04-30T12:07:00.000Z")
      )
    ).toBe(7);
    expect(
      mttrMinutes(
        new Date("2026-04-30T12:00:00.000Z"),
        new Date("2026-04-30T11:59:00.000Z")
      )
    ).toBe(0);
  });
});
