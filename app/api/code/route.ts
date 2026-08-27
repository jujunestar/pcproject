import { NextResponse } from "next/server";

function generateCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST() {
  const code = generateCode();
  return NextResponse.json({ code });
}
