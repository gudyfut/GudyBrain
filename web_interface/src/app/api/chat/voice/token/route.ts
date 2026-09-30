import { GoogleGenAI, Modality } from "@google/genai";
import { getChatSession } from "../../../../../server/chat";
import { requireSecret } from "../../../../../server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const model = "gemini-3.5-transcribe-live";

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin) {
    // Next pode normalizar request.url para localhost mesmo quando o navegador usa 127.0.0.1.
    const host = request.headers.get("Host") ?? new URL(request.url).host;
    try { if (new URL(origin).host !== host) return Response.json({ error: "Origem não autorizada." }, { status: 403 }); }
    catch { return Response.json({ error: "Origem inválida." }, { status: 403 }); }
  }
  const body = await request.json().catch(() => ({})) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string") return Response.json({ error: "Conversa obrigatória." }, { status: 400 });
  try { getChatSession(body.sessionId); }
  catch { return Response.json({ error: "Conversa expirada. Inicie uma nova conversa." }, { status: 404 }); }
  try {
    const ai = new GoogleGenAI({ apiKey: requireSecret("GEMINI_API_KEY"), httpOptions: { apiVersion: "v1beta" } });
    const token = await ai.authTokens.create({ config: {
      uses: 1,
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      expireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: { languageCodes: ["pt-BR"] },
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
      },
    } });
    if (!token.name) throw new Error("Token temporário vazio.");
    return Response.json({ token: token.name, model }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("GEMINI_API_KEY")
      ? "Configure GEMINI_API_KEY no .env para usar o microfone."
      : "Não foi possível iniciar a transcrição por voz. Confira a chave e a cota do Gemini.";
    return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
