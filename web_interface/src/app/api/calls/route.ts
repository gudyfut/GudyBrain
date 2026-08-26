import { NextResponse } from "next/server";
import { getCall, getTranscript, listCalls } from "../../../server/calls";
import { apiError } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ calls: listCalls() });
    if (url.searchParams.get("transcript") === "1") {
      return NextResponse.json({ transcript: getTranscript(id) });
    }
    return NextResponse.json(getCall(id));
  } catch (error) {
    return apiError(error);
  }
}
