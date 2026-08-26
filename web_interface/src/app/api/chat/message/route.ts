import { runChat } from "../../../../server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { sessionId?: string; message?: string };
  const input = body.message?.trim() ?? "";
  if (!body.sessionId || !input) {
    return Response.json({ error: "Conversa e mensagem são obrigatórias." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void runChat(body.sessionId as string, input, {
        signal: request.signal,
        onContent: (content) => send({ type: "content", content }),
        onStep: (event) => {
          if (event.type === "tool_call") send({ type: "tool", name: event.name });
        },
      }).then(() => {
        send({ type: "done" });
        controller.close();
      }).catch((error: unknown) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
