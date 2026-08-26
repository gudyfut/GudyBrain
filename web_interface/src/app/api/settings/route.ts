import { NextResponse } from "next/server";
import { apiError } from "../../../server/http";
import { getPublicSettings, updateAutomation } from "../../../server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(getPublicSettings());
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { transcribe?: boolean; analyze?: boolean };
    return NextResponse.json(updateAutomation(body));
  } catch (error) {
    return apiError(error);
  }
}
