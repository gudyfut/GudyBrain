/**
 * Parser minimo de frontmatter YAML para o bundle de memoria.
 *
 * Nao e um parser YAML completo (sem dependencias). Cobre o que a gente usa
 * para filtrar/buscar: campos planos `chave: valor` e listas inline
 * `[a, b, c]`. Objetos inline (`generated: { by, at }`) sao ignorados — nao
 * filtramos por eles. Se um dia precisar de YAML real, troque por uma lib.
 */

import { interpretarValorMemoria } from "./valores-yaml";

export interface Frontmatter {
  readonly campos: Record<string, string | string[] | null>;
  readonly corpo: string;
}

export function parseFrontmatter(conteudo: string): Frontmatter {
  const match = conteudo.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/,
  );
  if (!match || match[1] === undefined || match[2] === undefined) {
    return { campos: {}, corpo: conteudo };
  }

  const campos: Record<string, string | string[] | null> = {};
  for (const linhaRaw of match[1].split(/\r?\n/)) {
    const linha = linhaRaw.trim();
    if (!linha || linha.startsWith("#")) continue;

    const idx = linha.indexOf(":");
    if (idx === -1) continue;

    const chave = linha.slice(0, idx).trim();
    const valorCru = linha.slice(idx + 1).trim();
    if (!chave || !valorCru) continue;

    if (valorCru === "null" || valorCru === "~") {
      campos[chave] = null;
      continue;
    }

    // Objeto inline (ex.: generated: { by: ..., at: ... }) — ignora.
    if (valorCru.startsWith("{")) continue;

    const parsed = interpretarValorMemoria(valorCru);
    campos[chave] = parsed === null ? null : Array.isArray(parsed)
      ? parsed as string[] : String(parsed);
  }
  return { campos, corpo: match[2] };
}

/** Normaliza para busca sem acento e case-insensitive. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
