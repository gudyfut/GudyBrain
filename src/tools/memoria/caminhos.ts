import { resolve, join, normalize, sep } from "node:path";
import { PROJECT_ROOT } from "../../core/project-root";

// Raiz do bundle de memoria. Resolve a partir do cwd (raiz do projeto).
const MEMORY_ROOT = resolve(PROJECT_ROOT, "memory");

/**
 * Resolve um caminho relativo dentro do bundle memory/. Bloqueia "..", paths
 * absolutos e "~" para evitar leitura fora do bundle. Retorna o path absoluto.
 * String vazia => raiz do bundle.
 */
export function resolverCaminho(rel: string | undefined): string {
  const limpo = (rel ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (limpo === "") return MEMORY_ROOT;

  if (limpo.includes("..") || /^[A-Za-z]:[\\/]/.test(limpo) || limpo.startsWith("~")) {
    throw new Error(`Caminho invalido (tentativa de sair do bundle): "${rel ?? ""}"`);
  }

  const abs = normalize(join(MEMORY_ROOT, limpo));
  if (abs !== MEMORY_ROOT && !abs.startsWith(MEMORY_ROOT + sep)) {
    throw new Error(`Caminho fora do bundle: "${rel ?? ""}"`);
  }
  return abs;
}

/** Caminho relativo ao bundle (sem barra inicial), em barras "/", para mostrar
 *  ao modelo. Ex.: "social/pessoas/joao-silva.md". */
export function relativoDoBundle(abs: string): string {
  return abs
    .slice(MEMORY_ROOT.length)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}
