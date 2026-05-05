const baseUrl = process.env.IMS_API_URL || "http://localhost:3000";
const total = Number(process.env.LOAD_TOTAL || 5000);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 200);
const viewerKey = process.env.VIEWER_API_KEY || "viewer-demo-key";

function buildPayload(index) {
  return {
    component_id: `CACHE_CLUSTER_${String(index % 5).padStart(2, "0")}`,
    component_type: index % 2 === 0 ? "CACHE" : "QUEUE",
    message: `Synthetic load event #${index}`,
    timestamp: new Date().toISOString(),
    metadata: {
      synthetic: true,
      seq: index,
    },
  };
}

async function sendOne(index) {
  const response = await fetch(`${baseUrl}/signals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": viewerKey,
    },
    body: JSON.stringify(buildPayload(index)),
  });

  if (response.status === 429) {
    return { status: 429 };
  }

  if (!response.ok) {
    return { status: response.status };
  }
  return { status: 202 };
}

async function main() {
  const start = Date.now();
  let sent = 0;
  let accepted = 0;
  let rateLimited = 0;
  let failed = 0;

  while (sent < total) {
    const batchSize = Math.min(concurrency, total - sent);
    const tasks = [];
    for (let i = 0; i < batchSize; i += 1) {
      tasks.push(sendOne(sent + i));
    }
    const results = await Promise.all(tasks);
    for (const result of results) {
      if (result.status === 202) accepted += 1;
      else if (result.status === 429) rateLimited += 1;
      else failed += 1;
    }
    sent += batchSize;
  }

  const elapsedSeconds = Math.max(1, (Date.now() - start) / 1000);
  const rate = accepted / elapsedSeconds;
  console.log(
    `Load test complete: sent=${sent} accepted=${accepted} rate_limited=${rateLimited} failed=${failed} elapsed=${elapsedSeconds.toFixed(2)}s throughput=${rate.toFixed(2)} req/s`
  );
}

main().catch((error) => {
  console.error("Load test failed:", error);
  process.exit(1);
});
