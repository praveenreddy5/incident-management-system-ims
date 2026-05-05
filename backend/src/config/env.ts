const requiredEnv = [
  "DATABASE_URL",
  "MONGO_URL",
  "REDIS_URL",
] as const;

export function validateEnv(): void {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
