import mongoose from "mongoose";
export async function connectMongo(): Promise<void> {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is missing in .env");
  await mongoose.connect(mongoUrl);
}