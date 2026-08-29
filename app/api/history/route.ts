import { NextRequest, NextResponse } from "next/server";
import { parseValue } from "@/lib/performance-status";
import { redis } from "@/lib/redis-client";
import { historyKeyFor, sessionKeyFor } from "@/lib/redis-keys";

const HISTORY_MAX_ENTRIES = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { code?: string };
  const { code } = body;

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const raw = await redis.get<string>(sessionKeyFor(code));
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "no current data to record" }, { status: 400 });
  }

  const parsed = parseValue(raw);
  if (parsed.status !== "received") {
    return NextResponse.json({ error: "current data is not in a recordable state" }, { status: 400 });
  }

  const key = historyKeyFor(code);
  await redis.lpush(key, raw);
  await redis.ltrim(key, 0, HISTORY_MAX_ENTRIES - 1);
  await redis.expire(key, HISTORY_TTL_SECONDS);

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const entries = await redis.lrange<string>(historyKeyFor(code), 0, -1);
  return NextResponse.json({ entries: entries ?? [] });
}
