import "server-only";

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_PROFILES, MEMORY_CHAT_PROFILES, memoryChatEnabled } from "@gudybrain/agents/registry";
import { ensureEnvironment, REPO_ROOT } from "./paths";

export interface PublicSettings {
  readonly automation: { transcribe: boolean; analyzeRequested: boolean; analyzeEffective: boolean };
  readonly integrations: { glm: boolean; groq: boolean; discord: boolean; typesafe: boolean };
  readonly chat: { mode: "jev" | "legacy"; model: string };
  readonly agents: ReadonlyArray<{ id: string; name: string; model: string; responsibility: string }>;
}

export function getPublicSettings(): PublicSettings {
  ensureEnvironment();
  const transcribe = enabled(process.env.DISCORDBOT_AUTO_TRANSCRIBE, true);
  const analyzeRequested = enabled(process.env.DISCORDBOT_AUTO_ANALYZE, false);
  const jev = memoryChatEnabled();
  const model = jev ? process.env.OPENAI_MODEL?.trim() || MEMORY_CHAT_PROFILES.answer.model : AGENT_PROFILES.conversante.model;
  return {
    automation: { transcribe, analyzeRequested, analyzeEffective: transcribe && analyzeRequested },
    chat: { mode: jev ? "jev" : "legacy", model },
    integrations: {
      glm: Boolean(process.env.GLM_API_KEY?.trim()),
      groq: Boolean(process.env.GROQ_API_KEY?.trim()),
      discord: Boolean(process.env.DISCORDBOT_API_KEY?.trim()),
      typesafe: Boolean(process.env.TYPESAFE_API_KEY?.trim()),
    },
    agents: [{ id: "curador-chat", name: "Curadoria Jev + Responses API", model: process.env.OPENAI_MODEL?.trim() || MEMORY_CHAT_PROFILES.curation.model, responsibility: "Extrair fatos com evidências, selecionar com Jev e preparar propostas para revisão." }, ...Object.values(AGENT_PROFILES).filter((profile) => !jev || profile.id !== "conversante").map((profile) => ({
      id: profile.id,
      name: profile.nome,
      model: profile.model,
      responsibility: profile.responsabilidade,
    })), ...(jev ? [
      { id: "recuperador-jev", name: "Jev", model: process.env.JEV_MODEL?.trim() || MEMORY_CHAT_PROFILES.retrieval.model, responsibility: "Decidir quando buscar e selecionar os arquivos de memória." },
      { id: "resposta-memoria", name: "Gudman / Responses API", model, responsibility: "Responder com o contexto selecionado, usando o plano ChatGPT pela Responses API." },
    ] : [])],
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

export function updateOpenAIModel(model: string): void {
  ensureEnvironment();
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(model)) throw new Error("Identificador do modelo inválido.");
  const envPath = resolve(REPO_ROOT, ".env");
  const content = setEnvLine(readFileSync(envPath, "utf8"), "OPENAI_MODEL", model);
  const temporary = `${envPath}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, envPath);
  process.env.OPENAI_MODEL = model;
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
