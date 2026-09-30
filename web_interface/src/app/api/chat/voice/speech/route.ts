import { GoogleGenAI } from "@google/genai";
import { chatHistory } from "../../../../../server/chat";
import { requireSecret } from "../../../../../server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { sessionId?: unknown; text?: unknown };
  if (typeof body.sessionId !== "string" || typeof body.text !== "string") {
    return Response.json({ error: "Conversa e resposta são obrigatórias." }, { status: 400 });
  }
  try {
    const history = chatHistory(body.sessionId);
    if (!history.some((message) => message.role === "assistant" && message.content === body.text)) {
      return Response.json({ error: "Resposta não encontrada nesta conversa." }, { status: 403 });
    }
    const spoken = toSpeechText(body.text);
    if (!spoken || spoken.length > 8_000) {
      return Response.json({ error: "Esta resposta é longa demais para ser lida de uma vez." }, { status: 400 });
    }
    const ai = new GoogleGenAI({ apiKey: requireSecret("GEMINI_API_KEY"), httpOptions: { apiVersion: "v1beta" } });
    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash-lite-tts",
      input: [{ type: "user_input", content: [{ type: "text", text: spoken }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Charon" }] },
      stream: true,
      store: false,
    }, { maxRetries: 0 });
    let canceled = false;
    const audio = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let received = false;
          for await (const event of interaction) {
            if (canceled || request.signal.aborted) break;
            if (event.event_type !== "step.delta" || event.delta.type !== "audio" || !event.delta.data) continue;
            const chunk = Buffer.from(event.delta.data, "base64");
            if (!chunk.length) continue;
            received = true;
            controller.enqueue(Uint8Array.from(chunk));
          }
          if (canceled || request.signal.aborted) return;
          if (!received) throw new Error("Gemini não retornou áudio.");
          controller.close();
        } catch (error) { if (!canceled) controller.error(error); }
      },
      cancel() { canceled = true; },
    });
    return new Response(audio, {
      headers: { "Content-Type": "audio/L16;rate=24000;channels=1", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 429) {
      return Response.json({ error: "A cota gratuita de voz do Gemini foi atingida. Consulte o limite do modelo no Google AI Studio e tente novamente após a renovação." }, { status: 429 });
    }
    const message = error instanceof Error && error.message.includes("GEMINI_API_KEY")
      ? "Configure GEMINI_API_KEY no .env para ouvir as respostas."
      : "Não foi possível gerar a voz. Confira a cota e tente novamente.";
    return Response.json({ error: message }, { status: 503 });
  }
}

function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, " trecho de código. ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/[~*_]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
