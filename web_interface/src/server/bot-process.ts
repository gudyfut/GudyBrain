import "server-only";

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { DISCORD_ROOT, ensureEnvironment } from "./paths";

const CONTROL_PORT = 8765;

export interface BotRuntimeStatus {
  readonly process: "desligado" | "iniciando" | "online" | "erro";
  readonly pid: number | null;
  readonly error: string | null;
  readonly logs: readonly string[];
  readonly discord: Record<string, unknown> | null;
}

interface BotRuntime {
  child: ChildProcessWithoutNullStreams | null;
  token: string | null;
  state: BotRuntimeStatus["process"];
  error: string | null;
  logs: string[];
}

const globalRuntime = globalThis as typeof globalThis & { __gudyBotProcess?: BotRuntime };
const runtime = globalRuntime.__gudyBotProcess ?? {
  child: null,
  token: null,
  state: "desligado",
  error: null,
  logs: [],
};
globalRuntime.__gudyBotProcess = runtime;

export function startBot(): BotRuntimeStatus {
  if (runtime.child && runtime.child.exitCode === null) return baseStatus();
  ensureEnvironment();
  runtime.token = randomBytes(32).toString("hex");
  runtime.state = "iniciando";
  runtime.error = null;
  runtime.logs = [];
  const child = spawn(pythonExecutable(), ["-m", "gudybot", "bot"], {
    cwd: DISCORD_ROOT,
    env: {
      ...process.env,
      GUDYBOT_CONTROL_TOKEN: runtime.token,
      GUDYBOT_CONTROL_PORT: String(CONTROL_PORT),
    },
    windowsHide: true,
  });
  runtime.child = child;
  capture(child.stdout, false);
  capture(child.stderr, true);
  child.on("error", (error) => {
    runtime.state = "erro";
    runtime.error = error.message;
  });
  child.on("close", (code) => {
    if (runtime.state !== "desligado") {
      runtime.state = code === 0 ? "desligado" : "erro";
      runtime.error = code === 0 ? null : `Bot terminou com código ${code ?? "?"}.`;
    }
    runtime.child = null;
  });
  return baseStatus();
}

export function stopBot(): BotRuntimeStatus {
  runtime.state = "desligado";
  runtime.error = null;
  runtime.child?.kill();
  runtime.child = null;
  runtime.token = null;
  return baseStatus();
}

export async function botStatus(): Promise<BotRuntimeStatus> {
  let discord: Record<string, unknown> | null = null;
  if (runtime.child && runtime.token) {
    try {
      discord = await controlRequest("/status", "GET");
      runtime.state = "online";
    } catch (error) {
      if (runtime.state !== "iniciando") {
        runtime.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return { ...baseStatus(), discord };
}

export async function botAction(action: "entrar" | "gravar" | "parar" | "sair"): Promise<Record<string, unknown>> {
  if (runtime.state === "desligado" || !runtime.token) throw new Error("Inicie o bot primeiro.");
  return controlRequest(`/actions/${action}`, "POST");
}

async function controlRequest(path: string, method: "GET" | "POST"): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${CONTROL_PORT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${runtime.token ?? ""}` },
    signal: AbortSignal.timeout(2_000),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "Controle do bot indisponível.");
  return data;
}

function baseStatus(): BotRuntimeStatus {
  return {
    process: runtime.state,
    pid: runtime.child?.pid ?? null,
    error: runtime.error,
    logs: [...runtime.logs],
    discord: null,
  };
}

function capture(stream: NodeJS.ReadableStream, isError: boolean): void {
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      runtime.logs.push(line);
      if (runtime.logs.length > 250) runtime.logs.shift();
      (isError ? console.error : console.info)(`[discordbot] ${line}`);
    }
  });
}

function pythonExecutable(): string {
  const local = join(DISCORD_ROOT, ".venv", "Scripts", "python.exe");
  return existsSync(local) ? local : "python";
}
