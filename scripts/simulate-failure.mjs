import { readFile } from "node:fs/promises";

const baseUrl = process.env.IMS_API_URL || "http://localhost:3000";
const viewerKey = process.env.VIEWER_API_KEY || "viewer-demo-key";
const samplePath =
  process.env.SAMPLE_PATH || new URL("./sample-failure-events.json", import.meta.url);

const raw = await readFile(samplePath, "utf-8");
const events = JSON.parse(raw);

console.log(`Sending ${events.length} sample events to ${baseUrl}/signals`);

for (const event of events) {
  const response = await fetch(`${baseUrl}/signals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": viewerKey,
    },
    body: JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed ${response.status}: ${body}`);
  }
}

console.log("Sample events sent successfully.");
