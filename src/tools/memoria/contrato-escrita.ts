import { createHash } from "node:crypto";
import { ESTRUTURAS_MEMORIA, nomeSecaoCanonica, obterEstruturaMemoria } from "./estrutura";
import { idMemoriaValido } from "./ids";
import type { AlteracaoSecao } from "./preencher";

export const VERSAO_CONTRATO_ESCRITA = 2;
export type FormatoItem = "fato" | "interesse" | "relacao";
export interface ReferenciaEscrita { id: string; type: string; title: string; path: string }
export type ResolverReferencia = (id: string) => ReferenciaEscrita | undefined;

const idSchema = { type: "string", pattern: "^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" };
const textSchema = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "^[^\\r\\n]+$" });
export const SCHEMA_INSERCOES = {
  type: "array", maxItems: 24,
  items: {
    type: "object", additionalProperties: false,
    properties: {
      secao: { type: "string", enum: [...new Set(ESTRUTURAS_MEMORIA.flatMap((entry) => entry.secoes.map((section) => section.nome)))] },
      modo: { type: "string", enum: ["acrescentar", "substituir"] },
      itens: {
        type: "array", minItems: 1, maxItems: 50,
        items: { oneOf: [
          { type: "object", additionalProperties: false, properties: { tipo: { const: "fato", type: "string" }, texto: textSchema(2000), referencias: { type: "array", maxItems: 10, items: idSchema } }, required: ["tipo", "texto"] },
          { type: "object", additionalProperties: false, properties: { tipo: { const: "interesse", type: "string" }, nome: textSchema(60), detalhe: textSchema(72) }, required: ["tipo", "nome"] },
          { type: "object", additionalProperties: false, properties: { tipo: { const: "relacao", type: "string" }, alvo_id: idSchema, percepcoes: { type: "array", minItems: 1, maxItems: 20, items: textSchema(1000) } }, required: ["tipo", "alvo_id", "percepcoes"] },
        ] },
      },
    }, required: ["secao", "modo", "itens"],
  },
};

export function revisaoMemoria(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function formatoSecao(type: string, section: string): FormatoItem {
  const canonical = nomeSecaoCanonica(type, section);
  if (obterEstruturaMemoria(type)?.type === "Pessoa") {
    if (canonical === "Interesses") return "interesse";
    if (canonical === "Relações") return "relacao";
  }
  return "fato";
}

/** Fronteira da IA: aceita dados tipados, nunca fragmentos de Markdown. */
export function compilarInsercoes(
  type: string,
  value: unknown,
  resolveReference: ResolverReferencia,
): AlteracaoSecao[] {
  if (!Array.isArray(value) || value.length > 24) throw new Error("alteracoes deve ser uma lista de até 24 seções.");
  const seen = new Set<string>();
  return value.map((raw) => {
    const change = objeto(raw, ["secao", "modo", "itens"]);
    if (typeof change.secao !== "string") throw new Error("secao é obrigatória.");
    const section = nomeSecaoCanonica(type, change.secao);
    if (!section) throw new Error(`Seção não permitida para ${type}: ${change.secao}.`);
    if (seen.has(section)) throw new Error(`Seção repetida: ${section}.`);
    seen.add(section);
    if (change.modo !== "acrescentar" && change.modo !== "substituir") throw new Error("modo deve ser acrescentar ou substituir, explicitamente.");
    if (!Array.isArray(change.itens) || !change.itens.length || change.itens.length > 50) throw new Error("itens exige de 1 a 50 entradas; apagar seção não é operação da IA.");
    const format = formatoSecao(type, section);
    const targets = new Set<string>();
    const rendered = change.itens.map((rawItem) => {
      const item = objeto(rawItem, format === "fato" ? ["tipo", "texto", "referencias"]
        : format === "interesse" ? ["tipo", "nome", "detalhe"] : ["tipo", "alvo_id", "percepcoes"]);
      if (item.tipo !== format) throw new Error(`${type} > ${section} aceita somente itens do tipo ${format}.`);
      if (format === "interesse") {
        const name = texto(item.nome, 60);
        if (/[*\[\]\\]/u.test(name)) throw new Error("Nome de interesse não aceita marcadores Markdown.");
        const detail = item.detalhe === undefined ? "" : texto(item.detalhe, 72);
        if (detail.includes(";")) throw new Error("Interesse aceita detalhe curto, sem narrar vários episódios.");
        return `- **${escaparMarkdown(name)}**${detail ? ` ${escaparMarkdown(detail)}` : ""}`;
      }
      if (format === "relacao") {
        const target = referencia(item.alvo_id, resolveReference);
        if (target.type !== "Pessoa") throw new Error("O alvo de uma relação deve ser Pessoa.");
        if (targets.has(target.id)) throw new Error("Agrupe percepções do mesmo alvo em um único item.");
        targets.add(target.id);
        if (!Array.isArray(item.percepcoes) || !item.percepcoes.length || item.percepcoes.length > 20) throw new Error("percepcoes exige de 1 a 20 textos.");
        return `### ${link(target)}\n${unicos(item.percepcoes.map((entry) => `- ${escaparMarkdown(texto(entry, 1000))}`)).join("\n")}`;
      }
      const fact = texto(item.texto, 2000);
      if (item.referencias !== undefined && (!Array.isArray(item.referencias) || item.referencias.length > 10)) throw new Error("referencias deve conter até 10 IDs.");
      const references = (item.referencias as unknown[] | undefined) ?? [];
      const links = unicos(references.map((id) => link(referencia(id, resolveReference))));
      return `- ${escaparMarkdown(fact)}${links.length ? ` (${links.join("; ")})` : ""}`;
    });
    return { secao: section, modo: change.modo, conteudo: unicos(rendered).join(format === "relacao" ? "\n\n" : "\n") };
  });
}

function objeto(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Entrada do contrato deve ser objeto.");
  const result = value as Record<string, unknown>;
  const extras = Object.keys(result).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`Campos fora do contrato: ${extras.join(", ")}. Não envie conteudo/Markdown livre.`);
  return result;
}

function texto(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Texto deve ter uma linha não vazia e até ${max} caracteres.`);
  }
  if (/\b(?:fala|obs)_\d+\b/iu.test(value)) throw new Error("IDs de evidência pertencem à revisão, não ao texto permanente.");
  return value.trim();
}

export function escaparMarkdown(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#!|~]/g, "\\$&");
}

function referencia(value: unknown, resolve: ResolverReferencia): ReferenciaEscrita {
  if (!idMemoriaValido(value)) throw new Error("Referência exige ID imutável válido.");
  const target = resolve(value);
  if (!target || !/^(?:[a-z0-9-]+\/)+[a-z0-9-]+\.md$/u.test(target.path)) throw new Error("Referência inexistente ou caminho inválido.");
  texto(target.title, 200);
  return target;
}

function link(target: ReferenciaEscrita): string {
  // Entidades no título evitam quebrar o delimitador de links e o parser de Relações.
  const title = target.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\\/g, "&#92;");
  return `[${title}](/${target.path})`;
}

function unicos(values: string[]): string[] { return [...new Set(values)]; }
