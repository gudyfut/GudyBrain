import "server-only";

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_PROFILES, resolveModel } from "@gudybrain/agents/registry";
import { ensureEnvironment, REPO_ROOT } from "./paths";

export interface PublicSettings {
  readonly automation: { transcribe: boolean; analyzeRequested: boolean; analyzeEffective: boolean };
  readonly integrations: { glm: boolean; groq: boolean; discord: boolean };
  readonly agents: ReadonlyArray<{ id: string; name: string; model: string; responsibility: string }>;
  readonly user: { readonly name: string };
}

/** Primeiro nome opcional do dono do bundle, para saudações na interface. */
export function ownerDisplayName(): string {
  ensureEnvironment();
  const nome = process.env.USUARIO_NOME?.trim() ?? "";
  return nome.split(/\s+/)[0] ?? "";
}

export function getPublicSettings(): PublicSettings {
  ensureEnvironment();
  const transcribe = enabled(process.env.DISCORDBOT_AUTO_TRANSCRIBE, true);
  const analyzeRequested = enabled(process.env.DISCORDBOT_AUTO_ANALYZE, false);
  return {
    automation: { transcribe, analyzeRequested, analyzeEffective: transcribe && analyzeRequested },
    integrations: {
      glm: Boolean(process.env.GLM_API_KEY?.trim()),
      groq: Boolean(process.env.GROQ_API_KEY?.trim()),
      discord: Boolean(process.env.DISCORDBOT_API_KEY?.trim()),
    },
    agents: Object.values(AGENT_PROFILES).map((profile) => ({
      id: profile.id,
      name: profile.nome,
      model: resolveModel(profile),
      responsibility: profile.responsabilidade,
    })),
    user: { name: ownerDisplayName() },
  };
}

export function updateAutomation(input: { transcribe?: boolean; analyze?: boolean }): PublicSettings {
  const envPath = resolve(REPO_ROOT, ".env");
  let content = readFileSync(envPath, "utf8");
  if (typeof input.transcribe === "boolean") {
    content = setEnvLine(content, "DISCORDBOT_AUTO_TRANSCRIBE", String(input.transcribe));
    process.env.DISCORDBOT_AUTO_TRANSCRIBE = String(input.transcribe);
  }
  if (typeof input.analyze === "boolean") {
    content = setEnvLine(content, "DISCORDBOT_AUTO_ANALYZE", String(input.analyze));
    process.env.DISCORDBOT_AUTO_ANALYZE = String(input.analyze);
  }
  const temporary = `${envPath}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, envPath);
  return getPublicSettings();
}

function enabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !new Set(["0", "false", "nao", "não", "off"]).has(value.trim().toLowerCase());
}

function setEnvLine(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, `${key}=${value}`);
  return `${content.trimEnd()}\n${key}=${value}\n`;
}
