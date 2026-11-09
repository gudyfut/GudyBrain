import "server-only";
import { randomUUID } from "node:crypto";
import type { Message } from "@gudybrain/core/glm";
import { chatGPTAuth } from "@gudybrain/core/chatgpt-auth";
import { answerWithResponses } from "@gudybrain/core/responses";
import { MemoryConversation } from "@gudybrain/agents/conversante/memory-conversation";
import { memoryChatEnabled } from "@gudybrain/agents/registry";
import { claimVoiceSession, finishVoiceSession } from "./chat";
import { ensureEnvironment, requireSecret } from "./paths";
import { LiveController } from "./live-controller";
import { createLiveConnection, LiveError } from "./live-provider";

interface LiveRecord { chatId: string; controller: LiveController }
interface LiveRuntime { active?: string; sessions: Map<string, LiveRecord> }
const globalRuntime = globalThis as typeof globalThis & {
  __gudyLiveRuntime?: LiveRuntime;
};
const runtime: LiveRuntime = globalRuntime.__gudyLiveRuntime ??= { sessions: new Map() };

export async function startLive(chatId: string, sdp: string, signal: AbortSignal) {
  ensureEnvironment();
  if (!memoryChatEnabled()) throw new LiveError("A conversa ao vivo exige CHAT_MODE=decisions.", 400);
  const apiKey = requireSecret("GPT_API_KEY");
  const voice = process.env.GPT_LIVE_VOICE?.trim() || "marin";
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(voice)) throw new LiveError("GPT_LIVE_VOICE deve ser o nome de uma voz do GPT-Live.", 400);
  const idleMs = configSeconds("GPT_LIVE_IDLE_SECONDS", 90, 15, 300) * 1000;
  const maxMs = configSeconds("GPT_LIVE_MAX_SECONDS", 1800, 60, 7200) * 1000;
  if (runtime.active) throw new LiveError("Já existe uma conversa por voz aberta. Encerre-a antes de iniciar outra.", 409);
  const id = randomUUID();
  let history: readonly Message[];
  try { history = claimVoiceSession(chatId, id); }
  catch (error) { throw new LiveError(error instanceof Error ? error.message : "Conversa indisponível.", 409); }
  runtime.active = id;
  const earlyEvents: unknown[] = [];
  let controller: LiveController | undefined;
  let connectionFailed = false;
  try {
    await chatGPTAuth.accessToken(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    signal.throwIfAborted();
    const connection = await createLiveConnection({ apiKey, sdp, voice, history,
      onEvent: (event) => controller ? controller.receive(event) : earlyEvents.push(event),
      onFailure: () => { connectionFailed = true; controller?.transportFailed(); },
    });
    controller = new LiveController({ id, history, idleMs, maxMs, transport: connection.transport,
      query: async (input, context, taskSignal, onStep) => {
        const combined = AbortSignal.any([taskSignal, chatGPTAuth.sessionSignal(), AbortSignal.timeout(90_000)]);
        await chatGPTAuth.accessToken(combined);
        const agent = new MemoryConversation({ answer: (request) => answerWithResponses({ ...request,
          instructions: request.instructions + "\nA resposta será falada. Seja conciso, de preferência até 100 palavras. Preserve ressalvas e não omita fatos necessários. Não use tabelas ou blocos de código." }) });
        agent.history.push(...context.map((message) => ({ ...message })));
        return agent.run(input, { signal: combined, onStep });
      },
      onFinish: (messages) => {
        finishVoiceSession(chatId, id, messages);
        if (runtime.active === id) runtime.active = undefined;
        setTimeout(() => runtime.sessions.delete(id), 5 * 60_000).unref();
      },
    });
    runtime.sessions.set(id, { chatId, controller });
    for (const event of earlyEvents) controller.receive(event);
    if (connectionFailed) controller.transportFailed();
    if (signal.aborted) { await controller.close("page_closed"); throw new LiveError("A conexão foi cancelada.", 499); }
    if (["closing", "closed"].includes(controller.snapshot().phase)) {
      await controller.close("startup_failed");
      throw new LiveError("A sessão foi encerrada durante a conexão.", 502);
    }
    return { id, sdp: connection.sdp, model: "gpt-live-1", voice, maxSeconds: maxMs / 1000, idleSeconds: idleMs / 1000 };
  } catch (error) {
    if (controller) await controller.close("startup_failed");
    else { finishVoiceSession(chatId, id, []); if (runtime.active === id) runtime.active = undefined; }
    throw error;
  }
}

export function getLive(chatId: string, id: string): LiveController {
  const record = runtime.sessions.get(id);
  if (!record || record.chatId !== chatId) throw new LiveError("Conversa de voz não encontrada.", 404);
  return record.controller;
}

function configSeconds(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new LiveError(name + " deve estar entre " + minimum + " e " + maximum + " segundos.", 400);
  return number;
}
