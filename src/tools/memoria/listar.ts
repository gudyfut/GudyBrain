import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { resolverCaminho, relativoDoBundle } from "./caminhos";
import { parseFrontmatter } from "./frontmatter";
import {
  carregarCatalogoMemoria,
  criarIndiceTitulos,
  formatarPerfilIdentificacao,
  perfilIdentificacao,
} from "./catalogo";
import { registrarListagem } from "./contextualizacao";

/**
 * Skill memoria_listar: lista o conteudo IMEDIATO de uma pasta do bundle
 * (subpastas + arquivos .md), SEMPRE gerado a partir do disco (ignora index.md
 * manual — assim fica sempre atual, refletindo conceitos novos). Para cada .md
 * mostra uma assinatura compacta de frontmatter, resolvendo referências por ID
 * para os títulos atuais.
 *
 * Usado pelo agente pra ver quem/o que existe numa pasta (a arvore do system
 * so mostra pastas; esta skill mostra o conteudo).
 */
export async function memoriaListar(
  args: Record<string, unknown>,
): Promise<string> {
  const pasta = typeof args.pasta === "string" ? args.pasta : "";
  const abs = resolverCaminho(pasta);

  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return `Pasta nao encontrada: "${pasta || "/"}".`;
  }
  registrarListagem(pasta);
  const catalogo = carregarCatalogoMemoria();
  const catalogoPorPath = new Map(catalogo.map((item) => [item.path, item]));
  const titulosPorId = criarIndiceTitulos(catalogo);

  let nomes: string[];
  try {
    nomes = readdirSync(abs).sort();
  } catch {
    return `Pasta nao encontrada: "${pasta || "/"}".`;
  }

  const linhas: string[] = [];
  for (const nome of nomes) {
    if (nome.startsWith(".") || nome === "index.md") continue;
    const full = join(abs, nome);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      const n = contarConceitos(full);
      linhas.push(
        `- ${relativoDoBundle(full)}/ (pasta${n > 0 ? `, ${n} conceito(s)` : ""})`,
      );
    } else if (extname(nome) === ".md") {
      const { campos } = parseFrontmatter(readFileSync(full, "utf8"));
      const titulo =
        (typeof campos.title === "string" && campos.title) ||
        nome.replace(/\.md$/, "");
      const relativo = relativoDoBundle(full);
      const entrada = catalogoPorPath.get(relativo);
      const perfil = entrada
        ? formatarPerfilIdentificacao(perfilIdentificacao(entrada, titulosPorId))
        : `title=${titulo}`;
      linhas.push(`- ${relativo} :: ${perfil}`);
    }
  }

  if (linhas.length === 0) return `(pasta vazia: "${pasta || "/"}")`;
  return `Conteudo de "${pasta || "/"}":\n${linhas.join("\n")}`;
}

/** Conta .md (exceto index.md) recursivamente, so pra dar uma ideia do tamanho. */
function contarConceitos(dir: string): number {
  let nomes: string[];
  try {
    nomes = readdirSync(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const nome of nomes) {
    if (nome.startsWith(".") || nome === "index.md") continue;
    const full = join(dir, nome);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) n += contarConceitos(full);
    else if (extname(nome) === ".md") n++;
  }
  return n;
}
