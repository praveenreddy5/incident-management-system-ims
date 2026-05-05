import "dotenv/config";
import { connectMongo } from "./config/mongo";
import { validateEnv } from "./config/env";
import { startSignalWorker } from "./workers/signal.worker";
import { startThroughputLogger } from "./services/throughput.service";
import { app } from "./app";
const port = Number(process.env.PORT || 3000);

async function start(): Promise<void> {
  validateEnv();
  await connectMongo();

  startSignalWorker();
  startThroughputLogger();

  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});