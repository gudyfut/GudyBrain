import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { resolverCaminho, relativoDoBundle } from "./caminhos";
import { normalizar, parseFrontmatter } from "./frontmatter";

export interface EntradaCatalogoMemoria {
  readonly path: string;
  readonly id: string | null;
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly campos: Readonly<Record<string, string | string[] | null>>;
  readonly corpo: string;
}

export interface CorrespondenciaMemoria {
  readonly path: string;
  readonly id: string | null;
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly identification: Readonly<Record<string, string | readonly string[] | null>>;
}

export interface ConsultaContextualMemoria {
  readonly consulta?: string;
  readonly tipoMemoria?: string;
  readonly entidadeIds?: readonly string[];
  readonly pathsSugeridos?: readonly string[];
  readonly limite?: number;
}

const CAMPOS_IDENTIFICADORES: Readonly<Record<string, readonly string[]>> = {
  pessoa: ["apelido", "categoria", "vinculo"],
  grupo: ["tipo", "membros"],
  projeto: ["estado", "inicio", "fim", "participantes"],
  evento: ["tipo", "data", "datafim", "participantes", "lugares"],
  lugar: ["tipo"],
  conhecimento: ["natureza"],
};

/** Índice leve e determinístico do bundle. Não usa IA nem embeddings. */
export function carregarCatalogoMemoria(pasta = ""): EntradaCatalogoMemoria[] {
  const raiz = resolverCaminho(pasta);
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) return [];
  const arquivos: string[] = [];
  coletarMarkdown(raiz, arquivos);
  return arquivos.sort().map((arquivo) => {
    const { campos, corpo } = parseFrontmatter(readFileSync(arquivo, "utf8"));
    return {
      path: relativoDoBundle(arquivo),
      id: texto(campos.id),
      type: texto(campos.type) ?? "Desconhecido",
      title: texto(campos.title) ?? relativoDoBundle(arquivo),
      description: texto(campos.description),
      tags: lista(campos.tags),
      campos,
      corpo,
    };
  });
}

export function criarIndiceTitulos(
  catalogo: readonly EntradaCatalogoMemoria[],
): ReadonlyMap<string, string> {
  const indice = new Map<string, string>();
  for (const entrada of catalogo) {
    if (entrada.id) indice.set(entrada.id, entrada.title);
  }
  return indice;
}

/** Resumo de identificação usado por listagens e resultados contextuais. */
export function perfilIdentificacao(
  entrada: EntradaCatalogoMemoria,
  titulosPorId: ReadonlyMap<string, string>,
): Readonly<Record<string, string | readonly string[] | null>> {
  const perfil: Record<string, string | readonly string[] | null> = {
    id: entrada.id,
    type: entrada.type,
    title: entrada.title,
    description: entrada.description,
    tags: entrada.tags,
  };
  const campos = CAMPOS_IDENTIFICADORES[normalizar(entrada.type)] ?? [];
  for (const campo of campos) {
    const valor = entrada.campos[campo];
    if (Array.isArray(valor)) {
      perfil[campo] = valor.map((item) => titulosPorId.get(item)
        ? `${titulosPorId.get(item)} (${item})`
        : item);
    } else {
      perfil[campo] = valor ?? null;
    }
  }
  return perfil;
}

/** Recuperação lexical com bônus para IDs e referências estruturadas. */
export function buscarContextoMemoria(
  options: ConsultaContextualMemoria,
  catalogo: readonly EntradaCatalogoMemoria[] = carregarCatalogoMemoria(),
): CorrespondenciaMemoria[] {
  const query = normalizar(options.consulta ?? "");
  const tokens = tokensRelevantes(query);
  const type = normalizar(options.tipoMemoria ?? "");
  const entityIds = new Set((options.entidadeIds ?? []).filter(Boolean));
  const suggestedPaths = new Set((options.pathsSugeridos ?? []).map(normalizarPath));
  const titleIndex = criarIndiceTitulos(catalogo);
  const scored = catalogo.flatMap((entry) => {
    if (type && normalizar(entry.type) !== type) return [];
    const reasons: string[] = [];
    let score = 0;
    const path = normalizarPath(entry.path);
    if (suggestedPaths.has(path)) {
      score += 120;
      reasons.push("path sugerido no relatório");
    }
    if (entry.id && entityIds.has(entry.id)) {
      score += 110;
      reasons.push("ID da entidade coincide");
    }
    const referencedIds = Object.values(entry.campos).flatMap((value) => lista(value));
    const overlap = referencedIds.filter((id) => entityIds.has(id));
    if (overlap.length) {
      score += overlap.length * 32;
      reasons.push(`${overlap.length} participante(s)/entidade(s) coincide(m)`);
    }
    const title = normalizar(entry.title);
    const description = normalizar(entry.description ?? "");
    const tags = normalizar(entry.tags.join(" "));
    const frontmatter = normalizar(Object.values(entry.campos).flat().filter(Boolean).join(" "));
    const body = normalizar(entry.corpo);
    if (query && title.includes(query)) {
      score += 45;
      reasons.push("título coincide com a consulta");
    }
    if (query && description.includes(query)) {
      score += 24;
      reasons.push("descrição coincide com a consulta");
    }
    let tokenMatches = 0;
    for (const token of tokens) {
      if (title.includes(token)) { score += 12; tokenMatches += 1; }
      if (tags.includes(token)) { score += 9; tokenMatches += 1; }
      if (description.includes(token)) { score += 6; tokenMatches += 1; }
      if (frontmatter.includes(token)) { score += 4; tokenMatches += 1; }
      if (body.includes(token)) { score += 1; tokenMatches += 1; }
    }
    if (tokenMatches) reasons.push(`${tokenMatches} coincidência(s) lexical(is)`);
    if (!query && !entityIds.size && !suggestedPaths.size) score = 1;
    if (score <= 0) return [];
    return [{
      path: entry.path,
      id: entry.id,
      type: entry.type,
      title: entry.title,
      description: entry.description,
      score,
      reasons,
      identification: perfilIdentificacao(entry, titleIndex),
    } satisfies CorrespondenciaMemoria];
  });
  return scored
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "pt-BR"))
    .slice(0, Math.min(Math.max(options.limite ?? 5, 1), 10));
}

export function formatarPerfilIdentificacao(
  perfil: Readonly<Record<string, string | readonly string[] | null>>,
): string {
  return Object.entries(perfil)
    .filter(([, value]) => value !== null && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("; ");
}

function coletarMarkdown(directory: string, output: string[]): void {
  for (const name of readdirSync(directory)) {
    if (name.startsWith(".")) continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) coletarMarkdown(path, output);
    else if (extname(name) === ".md" && name !== "index.md") output.push(path);
  }
}

function texto(value: string | string[] | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lista(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function normalizarPath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").replace(/\.md$/iu, "").toLowerCase();
}

function tokensRelevantes(value: string): string[] {
  const stopwords = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "para", "por", "com", "um", "uma", "que", "se", "no", "na"]);
  return [...new Set(value.split(/[^a-z0-9_]+/u).filter((token) => token.length >= 3 && !stopwords.has(token)))];
}
