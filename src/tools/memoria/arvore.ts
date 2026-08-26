import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolverCaminho } from "./caminhos";

/**
 * Gera a arvore de PASTAS do bundle memory/ (sem arquivos), limitada a
 * `profundidadeMax` niveis. So a hierarquia de diretorios — o agente ve onde
 * procurar e usa memoria_listar pra ver o conteudo de cada pasta. Assim o
 * system prompt fica pequeno e estavel, independente de quantos conceitos
 * existam no bundle.
 */
export function gerarArvoreMemoria(profundidadeMax = 4): string {
  const raiz = resolverCaminho("");
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) {
    return "(bundle memory/ nao encontrado)";
  }
  const linhas: string[] = ["memory/"];
  caminhar(raiz, 1, profundidadeMax, linhas);
  return linhas.join("\n");
}

function caminhar(
  dir: string,
  profundidade: number,
  max: number,
  out: string[],
): void {
  if (profundidade > max) return;
  let nomes: string[];
  try {
    nomes = readdirSync(dir);
  } catch {
    return;
  }
  const pastas = nomes
    .filter((n) => !n.startsWith("."))
    .map((n) => {
      let st;
      try {
        st = statSync(join(dir, n));
      } catch {
        return null;
      }
      return st?.isDirectory() ? n : null;
    })
    .filter((n): n is string => n !== null)
    .sort((a, b) => a.localeCompare(b));

  const ind = "  ".repeat(profundidade);
  for (const nome of pastas) {
    out.push(`${ind}${nome}/`);
    caminhar(join(dir, nome), profundidade + 1, max, out);
  }
}
