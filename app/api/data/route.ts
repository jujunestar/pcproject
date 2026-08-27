import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// 스켈레톤 검증용 TTL. 실제 세션 수명은 아직 정하지 않았다.
const TTL_SECONDS = 60 * 60;

function keyFor(code: string): string {
  return `session:${code}`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { code?: string; value?: string };
  const { code, value } = body;

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  await redis.set(keyFor(code), value, { ex: TTL_SECONDS });
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const value = await redis.get<string>(keyFor(code));
  return NextResponse.json({ value: value ?? null });
}
