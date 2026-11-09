import { LiveError } from "./live-provider";

export type LiveRequest = { action: "start"; sessionId: string; sdp: string }
  | { action: "ready" | "stop"; sessionId: string; liveId: string };

export async function readLiveRequest(request: Request): Promise<LiveRequest> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new LiveError("Envie JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new LiveError("Solicitação vazia.", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) { await reader.cancel(); throw new LiveError("Solicitação de voz muito grande.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LiveError("JSON inválido.", 400); }
  if (!body || typeof body !== "object" || typeof body.sessionId !== "string" || !validId(body.sessionId)) throw new LiveError("Conversa obrigatória.", 400);
  if (body.action === "start" && typeof body.sdp === "string" && body.sdp.startsWith("v=0") && body.sdp.length <= 60_000) {
    return { action: "start", sessionId: body.sessionId, sdp: body.sdp };
  }
  if ((body.action === "stop" || body.action === "ready") && typeof body.liveId === "string" && validId(body.liveId)) {
    return { action: body.action, sessionId: body.sessionId, liveId: body.liveId };
  }
  throw new LiveError("Ação de voz inválida.", 400);
}

export function validId(value: string): boolean { return /^[a-zA-Z0-9_-]{1,128}$/.test(value); }

export function liveErrorResponse(error: unknown): Response {
  if (error instanceof LiveError) return Response.json({ error: error.message }, { status: error.status });
  // Known local configuration errors are safe; provider response bodies are not.
  const message = error instanceof Error && /^GPT_API_KEY não está configurada/.test(error.message)
    ? error.message : "Não foi possível iniciar a voz. Confira as credenciais e a conexão ChatGPT em Configurações.";
  return Response.json({ error: message }, { status: 503 });
}
