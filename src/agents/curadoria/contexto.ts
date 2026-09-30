import { gerarArvoreMemoria } from "../../tools/memoria/arvore";
import { ESTRUTURAS_MEMORIA } from "../../tools/memoria/estrutura";
import { formatoSecao } from "../../tools/memoria/contrato-escrita";

/** Contexto estrutural compacto comum aos curadores. Os detalhes completos de
 * cada tipo continuam disponíveis sob demanda em memoria_template. */
export function suffixCuradoria(): string {
  const catalogo = ESTRUTURAS_MEMORIA.map((estrutura) => [
    `### ${estrutura.type}`,
    estrutura.definicao,
    ...estrutura.secoes.map((secao) => `- **${secao.nome}** (item ${formatoSecao(estrutura.type, secao.nome)}): ${secao.finalidade}`),
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
  return `## Contrato de escrita v2\n\nEnvie versao=2. Cada alteração tem secao, modo e itens tipados. Nunca envie corpo ou conteudo Markdown. O código gera os títulos, bullets e links. Substituir uma seção exige reenviar seus itens preservados; prefira acrescentar para fatos novos.\n\n## Contrato semântico resumido da memória\n\n${catalogo}${blocoArvore}`;
}
