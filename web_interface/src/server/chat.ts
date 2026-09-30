import "server-only";

import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@gudybrain/core/agent";
import type { Message } from "@gudybrain/core/glm";
import { criarConversante, type ConversationAgent } from "@gudybrain/agents/conversante";
import { memoryChatEnabled } from "@gudybrain/agents/registry";
import { chatGPTAuth } from "@gudybrain/core/chatgpt-auth";
import { ensureEnvironment } from "./paths";

interface ChatSession {
  readonly id: string;
  readonly agent: ConversationAgent;
  busy: boolean;
  updatedAt: number;
}

interface ChatRuntime {
  sessions: Map<string, ChatSession>;
}

const globalRuntime = globalThis as typeof globalThis & {
  __gudyChatRuntime?: ChatRuntime;
};

const runtime = globalRuntime.__gudyChatRuntime ?? { sessions: new Map() };
globalRuntime.__gudyChatRuntime = runtime;

export function createChatSession(): ChatSession {
  ensureEnvironment();
  pruneSessions();
  const id = randomUUID();
  const session: ChatSession = {
    id,
    agent: criarConversante({ apiKey: process.env.GLM_API_KEY }).agent,
    busy: false,
    updatedAt: Date.now(),
  };
  runtime.sessions.set(id, session);
  return session;
}

export function getChatSession(id: string): ChatSession {
  const session = runtime.sessions.get(id);
  if (!session) throw new Error("Conversa expirada. Inicie uma nova conversa.");
  session.updatedAt = Date.now();
  return session;
}

export function deleteChatSession(id: string): void {
  runtime.sessions.delete(id);
}

export function chatHistory(id: string): readonly Message[] {
  const session = getChatSession(id);
  if (session.busy) throw new Error("Aguarde a resposta terminar antes de memorizar.");
  return session.agent.history.map((message) => ({ ...message }));
}

export async function runChat(
  id: string,
  input: string,
  callbacks: {
    onContent: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onStep?: (event: AgentEvent) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const session = getChatSession(id);
  if (session.busy) throw new Error("Gudman ainda está respondendo nesta conversa.");
  session.busy = true;
  try {
    const signal = memoryChatEnabled() ? AbortSignal.any([chatGPTAuth.sessionSignal(), ...(callbacks.signal ? [callbacks.signal] : [])]) : callbacks.signal;
    if (memoryChatEnabled()) await chatGPTAuth.accessToken(signal);
    return await session.agent.run(input, { ...callbacks, signal });
  } finally {
    session.busy = false;
    session.updatedAt = Date.now();
  }
}

function pruneSessions(): void {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, session] of runtime.sessions) {
    if (!session.busy && session.updatedAt < cutoff) runtime.sessions.delete(id);
  }
}
