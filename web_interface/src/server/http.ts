import "server-only";

import { NextResponse } from "next/server";

export function apiError(error: unknown, status = 400): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
