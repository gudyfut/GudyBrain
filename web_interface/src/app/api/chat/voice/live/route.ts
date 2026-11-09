import { getLive, startLive } from "../../../../../server/live";
import { readLiveRequest, liveErrorResponse, validId } from "../../../../../server/live-http";
import { localAccessAllowed } from "../../../../../server/local-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!localAccessAllowed(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  try {
    const body = await readLiveRequest(request);
    if (body.action === "start") return Response.json(await startLive(body.sessionId, body.sdp, request.signal), { status: 201 });
    const live = getLive(body.sessionId, body.liveId);
    if (body.action === "ready") { live.ready(); return Response.json({ ok: true }); }
    return Response.json(await live.close());
  } catch (error) { return liveErrorResponse(error); }
}

export function GET(request: Request): Response {
  if (!localAccessAllowed(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = params.get("sessionId") ?? "";
    const liveId = params.get("liveId") ?? "";
    if (!validId(sessionId) || !validId(liveId)) return Response.json({ error: "Conversa obrigatória." }, { status: 400 });
    const live = getLive(sessionId, liveId);
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const stop = (closeStream = true) => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          request.signal.removeEventListener("abort", abort);
          if (closeStream) controller.close();
        };
        const abort = () => { stop(); void live.close("page_closed"); };
        cleanup = () => { stop(false); void live.close("page_closed"); };
        request.signal.addEventListener("abort", abort, { once: true });
        unsubscribe = live.subscribe((event) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) < -32) { stop(); void live.close("connection_lost"); return; }
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          if (event.type === "snapshot" && event.state.phase === "closed") stop();
        });
        if (closed) unsubscribe();
        else heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode('{"type":"heartbeat"}\n'));
        }, 10_000);
        if (request.signal.aborted) abort();
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return liveErrorResponse(error); }
}
