import { randomUUID } from "node:crypto";

/** Identificador estável, independente de título, path e tipo do conceito. */
export const MEMORY_ID_PATTERN =
  /^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function idMemoriaValido(valor: unknown): valor is string {
  return typeof valor === "string" && MEMORY_ID_PATTERN.test(valor);
}

export function criarIdMemoria(): string {
  return `mem_${randomUUID()}`;
}

export function extrairIdMemoria(frontmatter: string): string | undefined {
  const valor = frontmatter.match(/^\s*id\s*:\s*([^\r\n]+)/m)?.[1]?.trim();
  return valor?.replace(/^['"]|['"]$/g, "");
}
