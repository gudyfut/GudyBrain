import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { resolverCaminho } from "./caminhos";
import { relativoDoBundle } from "./caminhos";
import { registrarLeitura } from "./contextualizacao";

/**
 * Skill memoria_ler: abre o conteudo COMPLETO de um conceito do bundle
 * (frontmatter + corpo), dado o path relativo. Aceita com ou sem .md.
 */
export async function memoriaLer(
  args: Record<string, unknown>,
): Promise<string> {
  const alvo = typeof args.path === "string" ? args.path.trim() : "";
  if (!alvo) {
    return "Path vazio. Passe o caminho do conceito (ex: social/pessoas/joao-silva).";
  }

  const abs = resolverCaminho(alvo.replace(/^\/+/, ""));
  const candidatos = extname(abs) === ".md" ? [abs] : [abs + ".md", abs];

  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) {
      registrarLeitura(relativoDoBundle(c));
      return readFileSync(c, "utf8");
    }
  }
  return `Conceito nao encontrado: "${alvo}".`;
}
