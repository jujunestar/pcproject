import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.NEWKV_KV_REST_API_URL!,
  token: process.env.NEWKV_KV_REST_API_TOKEN!,
  automaticDeserialization: false,
});
