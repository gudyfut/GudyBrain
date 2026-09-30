import { runChat } from "../../../../server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { sessionId?: string; message?: string };
  const input = typeof body.message === "string" ? body.message.trim() : "";
  if (typeof body.sessionId !== "string" || !body.sessionId || !input) {
    return Response.json({ error: "Conversa e mensagem são obrigatórias." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>): void => {
        if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void runChat(body.sessionId as string, input, {
        signal,
        onContent: (content) => send({ type: "content", content }),
        onStep: (event) => {
          if (event.type === "tool_call") send({ type: "tool", name: event.name });
          if (event.type === "retrieval") send({ type: "activity", message: event.message });
          if (event.type === "retrieval_trace") send({ type: "retrieval", event: event.event });
        },
      }).then(() => {
        send({ type: "done" });
        if (!closed) { closed = true; controller.close(); }
      }).catch((error: unknown) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        if (!closed) { closed = true; controller.close(); }
      });
    },
    cancel() { closed = true; abort.abort(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
