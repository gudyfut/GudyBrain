import "server-only";

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolverCaminho, relativoDoBundle } from "@gudybrain/tools/memoria/caminhos";
import { parseFrontmatter, normalizar } from "@gudybrain/tools/memoria/frontmatter";
import {
  interpretarDocumentoEditavel,
  montarPreviaMemoria,
} from "@gudybrain/tools/memoria/documento-editavel";
import {
  memoriaAtualizar,
  normalizarCaminhoRelativo,
} from "@gudybrain/tools/memoria/escrever";

export interface MemorySummary {
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly description: string;
  readonly category: string | null;
  readonly updatedAt: string;
}

export function listMemories(query = "", type = ""): MemorySummary[] {
  const files: string[] = [];
  collectMarkdown(resolverCaminho(""), files);
  const normalizedQuery = normalizar(query);
  return files.flatMap((file) => {
    const content = readFileSync(file, "utf8");
    const { campos } = parseFrontmatter(content);
    if (!campos.id) return [];
    const memoryType = typeof campos.type === "string" ? campos.type : "Memória";
    if (type && normalizar(memoryType) !== normalizar(type)) return [];
    if (normalizedQuery && !normalizar(content).includes(normalizedQuery)) return [];
    return [{
      path: relativoDoBundle(file),
      title: typeof campos.title === "string" ? campos.title : relativoDoBundle(file),
      type: memoryType,
      description: typeof campos.description === "string" ? campos.description : "",
      category: typeof campos.categoria === "string" ? campos.categoria : null,
      updatedAt: statSync(file).mtime.toISOString(),
    }];
  }).sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

export function readMemory(relativePath: string): { summary: MemorySummary; content: string } {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..") || !normalized.endsWith(".md")) {
    throw new Error("Caminho de memória inválido.");
  }
  const file = resolverCaminho(normalized);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error("Memória não encontrada.");
  const content = readFileSync(file, "utf8");
  const { campos } = parseFrontmatter(content);
  return {
    summary: {
      path: relativoDoBundle(file),
      title: typeof campos.title === "string" ? campos.title : normalized,
      type: typeof campos.type === "string" ? campos.type : "Memória",
      description: typeof campos.description === "string" ? campos.description : "",
      category: typeof campos.categoria === "string" ? campos.categoria : null,
      updatedAt: statSync(file).mtime.toISOString(),
    },
    content,
  };
}

export function previewMemoryChange(options: {
  action: "criar" | "atualizar";
  origin?: string;
  frontmatter: Record<string, unknown>;
  body: string;
}): { current: string; proposed: string } {
  const current = options.action === "atualizar"
    ? readMemory(normalizarCaminhoRelativo(options.origin ?? "")).content
    : "";
  return {
    current,
    proposed: montarPreviaMemoria(current, options.frontmatter, options.body),
  };
}

/** Edição humana direta, mas ainda passando pelas mesmas regras de schema,
 * ID, proveniência e escrita atômica usadas pela curadoria. */
export async function updateMemoryDocument(
  relativePath: string,
  content: string,
): Promise<{ summary: MemorySummary; content: string; result: string }> {
  const normalized = normalizarCaminhoRelativo(relativePath);
  const current = readMemory(normalized).content;
  const edited = interpretarDocumentoEditavel(content, current);
  const result = await memoriaAtualizar({
    path_origem: normalized,
    path: normalized,
    frontmatter: edited.campos,
    corpo: edited.corpo,
  }, { generatedBy: "gudman/editor-web" });
  if (!result.startsWith("Atualizado")) throw new Error(result);
  return { ...readMemory(normalized), result };
}

function collectMarkdown(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, files);
    else if (entry.name.endsWith(".md") && entry.name !== "index.md") files.push(full);
  }
}
