import { NextResponse } from "next/server";
import { createChatSession, deleteChatSession } from "../../../../server/chat";
import { apiError } from "../../../../server/http";

export const runtime = "nodejs";

export function POST(): NextResponse {
  try {
    return NextResponse.json({ id: createChatSession().id });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { id?: string };
    if (body.id) deleteChatSession(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
