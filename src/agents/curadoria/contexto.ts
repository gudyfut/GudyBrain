import { gerarArvoreMemoria } from "../../tools/memoria/arvore";
import { ESTRUTURAS_MEMORIA } from "../../tools/memoria/estrutura";

/** Contexto estrutural compacto comum aos curadores. Os detalhes completos de
 * cada tipo continuam disponíveis sob demanda em memoria_template. */
export function suffixCuradoria(): string {
  const catalogo = ESTRUTURAS_MEMORIA.map((estrutura) => [
    `### ${estrutura.type}`,
    estrutura.definicao,
    ...estrutura.secoes.map((secao) => `- **${secao.nome}:** ${secao.finalidade}`),
  ].join("\n")).join("\n\n");

  let arvore = "";
  try {
    arvore = gerarArvoreMemoria(Number(process.env.MEMORIA_ARVORE_NIVEIS) || 4);
  } catch {
    // O catálogo ainda é útil mesmo se o bundle estiver temporariamente indisponível.
  }
  const blocoArvore = arvore && !arvore.startsWith("(")
    ? `\n\n## Pastas atuais do bundle\n\n\`\`\`text\n${arvore}\n\`\`\``
    : "";
  return `## Contrato semântico resumido da memória\n\n${catalogo}${blocoArvore}`;
}
