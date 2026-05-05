import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

describe("API auth integration", () => {
  it("rejects missing api key on ingestion", async () => {
    const response = await request(app).post("/signals").send({
      component_id: "CACHE_CLUSTER_01",
      component_type: "CACHE",
      message: "latency spike",
      timestamp: new Date().toISOString(),
    });

    expect(response.status).toBe(401);
  });

  it("accepts valid viewer key and enforces role checks", async () => {
    const response = await request(app)
      .get("/incidents/ops/queue")
      .set("x-api-key", "viewer-demo-key");
    // viewer passes auth but fails admin authorization at route-level.
    expect(response.status).toBe(403);
  });

  it("rejects invalid viewer key", async () => {
    const response = await request(app)
      .post("/signals")
      .set("x-api-key", "invalid-key")
      .send({
        component_id: "CACHE_CLUSTER_01",
        component_type: "CACHE",
        message: "latency spike",
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(401);
  });
});
