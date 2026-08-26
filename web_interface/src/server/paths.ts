import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "@gudybrain/core/env";
import { PROJECT_ROOT } from "@gudybrain/core/project-root";

export const REPO_ROOT = PROJECT_ROOT;
export const RECORDINGS_ROOT = resolve(REPO_ROOT, "discordbot", "gravacoes");
export const DISCORD_ROOT = resolve(REPO_ROOT, "discordbot");

let environmentLoaded = false;

export function ensureEnvironment(): void {
  if (environmentLoaded) return;
  loadEnv(resolve(REPO_ROOT, ".env"));
  environmentLoaded = true;
}

export function requireSecret(name: string): string {
  ensureEnvironment();
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não está configurada no .env da raiz.`);
  return value;
}

export function resolveSessionDir(sessionId: string): string {
  if (!/^[\w.-]+$/u.test(sessionId)) throw new Error("Identificador de sessão inválido.");
  const target = resolve(RECORDINGS_ROOT, sessionId);
  if (!target.startsWith(`${RECORDINGS_ROOT}\\`) || !existsSync(target)) {
    throw new Error("Sessão não encontrada.");
  }
  return target;
}
