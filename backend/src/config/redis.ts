import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is missing in .env");
}

export const redis = new IORedis(redisUrl);

export const bullRedis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});