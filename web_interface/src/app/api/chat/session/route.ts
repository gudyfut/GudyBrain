import { NextResponse } from "next/server";
import { createChatSession, deleteChatSession } from "../../../../server/chat";
import { apiError } from "../../../../server/http";

export const runtime = "nodejs";

export function POST(): NextResponse {
  try {
    const session = createChatSession();
    return NextResponse.json({ id: session.id, model: session.agent.model });
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
