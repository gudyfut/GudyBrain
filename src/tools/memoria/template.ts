import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectPath } from "../../core/project-root";
import { formatoSecao } from "./contrato-escrita";
import {
  descreverEstruturaMemoria,
  ESTRUTURAS_MEMORIA,
  obterEstruturaMemoria,
} from "./estrutura";

/**
 * Handler da skill memoria_template (uso do curador). Devolve o conteudo do
 * index.md da pasta do tipo pedido — la esta descrito o template daquele tipo
 * (campos + secoes + convencoes). Substitui o antigo memoria_exemplo: em vez de
 * puxar um arquivo real, o curador le a definicao curada do template.
 */
export async function memoriaTemplate(
  args: Record<string, unknown>,
): Promise<string> {
  const type = typeof args.type === "string" ? args.type.trim() : "";
  if (!type) return "Erro: 'type' e obrigatorio.";

  const estrutura = obterEstruturaMemoria(type);
  if (!estrutura) {
    return `Erro: tipo desconhecido "${type}". Tipos conhecidos: ${ESTRUTURAS_MEMORIA.map((item) => item.type).join(", ")}.`;
  }
  const pasta = estrutura.pasta;

  const idx = join(resolveProjectPath("memory-template", pasta), "index.md");
  const contrato = descreverEstruturaMemoria(type);
  return [
    `Contrato estrutural de "${type}" (pasta ${pasta}):`,
    "",
    contrato,
    "Contrato de inserção v2: versao=2; alteracoes=[{secao, modo, itens}].",
    ...estrutura.secoes.map((section) => `${section.nome}: itens do tipo ${formatoSecao(type, section.nome)}.`),
    "fato={tipo:'fato',texto,referencias?:[IDs]}; interesse={tipo:'interesse',nome,detalhe?}; relacao={tipo:'relacao',alvo_id,percepcoes:[textos]}. Não envie Markdown; IDs de relações precisam apontar para Pessoas existentes.",
    "",
    "Documentação completa do template:",
    "",
    existsSync(idx) ? readFileSync(idx, "utf8").trim() : "Sem documentação adicional; use o contrato canônico acima.",
  ].join("\n");
}
