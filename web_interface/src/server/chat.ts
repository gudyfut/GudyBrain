import "server-only";

import { randomUUID } from "node:crypto";
import type { Agent, AgentEvent } from "@gudybrain/core/agent";
import type { Message } from "@gudybrain/core/glm";
import { criarConversante } from "@gudybrain/agents/conversante";
import { requireSecret } from "./paths";

interface ChatSession {
  readonly id: string;
  readonly agent: Agent;
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
  pruneSessions();
  const id = randomUUID();
  const session: ChatSession = {
    id,
    agent: criarConversante({ apiKey: requireSecret("GLM_API_KEY") }).agent,
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
  return [...getChatSession(id).agent.history];
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
    return await session.agent.run(input, callbacks);
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
