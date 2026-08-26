import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolverCaminho } from "./caminhos";
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

  const idx = join(resolverCaminho(pasta), "index.md");
  if (!existsSync(idx)) {
    return `Erro: sem index.md em "${pasta}". Escreva o template la.`;
  }
  const contrato = descreverEstruturaMemoria(type);
  return [
    `Contrato estrutural de "${type}" (pasta ${pasta}):`,
    "",
    contrato,
    "",
    "Documentação completa do template:",
    "",
    readFileSync(idx, "utf8").trim(),
  ].join("\n");
}
