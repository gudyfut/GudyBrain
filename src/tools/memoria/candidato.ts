/**
 * Skill memoria_preparar_candidato (uso exclusivo dos curadores). NAO escreve
 * em disco. O curador entrega deltas por seção; o preenchedor determinístico
 * monta o documento completo e o stageia para revisão humana.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolverCaminho } from "./caminhos";
import { erroDataNascimento } from "./datas";
import { erroCamposGerenciados } from "./schema";
import { normalizarCaminhoRelativo, validarDestinoMemoria } from "./escrever";
import { preencherDocumentoCandidato } from "./preencher";
import { compilarInsercoes, revisaoMemoria, VERSAO_CONTRATO_ESCRITA } from "./contrato-escrita";
import { carregarCatalogoMemoria } from "./catalogo";
import {
  obterAvaliacoesPara,
  obterContextoConsultado,
  validarContextoCandidato,
  type AvaliacaoNovidade,
  type ClassificacaoNovidade,
} from "./contextualizacao";
import { erroIntegridadeReferencias } from "./referencias";

export type AcaoCandidato = "criar" | "atualizar";

export interface Candidato {
  readonly contractVersion?: number;
  readonly baseRevision?: string;
  readonly acao: AcaoCandidato;
  /** Caminho atual em atualizações; difere de path quando há renomeação. */
  readonly pathOrigem?: string;
  /** Caminho final desejado. */
  readonly path: string;
  readonly frontmatter: Record<string, unknown>;
  readonly corpo: string;
  readonly motivo: string;
  readonly naturezaProposta: "explicita" | "sintese_interpretativa";
  readonly evidencias: readonly string[];
  /** IDs do relatório de call incorporados; vazio em conversas diretas. */
  readonly observationIds: readonly string[];
  readonly noveltyAssessments: readonly AvaliacaoNovidade[];
  readonly consultedPaths: readonly string[];
}

const fila: Candidato[] = [];

export function limparFila(): void {
  fila.length = 0;
}

export function obterFila(): Candidato[] {
  return [...fila];
}

export async function memoriaPrepararCandidato(
  args: Record<string, unknown>,
): Promise<string> {
  if (args.versao !== VERSAO_CONTRATO_ESCRITA) return "Erro: use versao=2 e alteracoes com itens tipados, sem Markdown livre.";
  const permitidos = ["versao", "acao", "path", "path_origem", "tipo_memoria", "frontmatter", "alteracoes", "motivo", "natureza_proposta", "evidencias", "observacao_ids", "avaliacao_novidade"];
  if (Object.keys(args).some((key) => !permitidos.includes(key))) return "Erro: campo desconhecido no contrato da proposta; não envie corpo/conteudo.";
  if (args.acao !== "criar" && args.acao !== "atualizar") return "Erro: acao deve ser criar ou atualizar.";
  if ("corpo" in args || "conteudo" in args) return "Erro: o contrato não aceita documento completo.";
  const acao: AcaoCandidato = args.acao;
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return "Erro: 'path' e obrigatorio.";
  const pathOrigemArg =
    typeof args.path_origem === "string" ? args.path_origem.trim() : "";
  const pathOrigem = acao === "atualizar" ? pathOrigemArg || path : undefined;

  const erroAlvo = validarAlvosCandidato(acao, path, pathOrigem);
  if (erroAlvo) return `Erro: ${erroAlvo}`;

  const type = typeof args.tipo_memoria === "string" ? args.tipo_memoria.trim() : "";
  if (!type) return "Erro: 'tipo_memoria' e obrigatorio.";
  const erroDestino = validarDestinoMemoria(normalizarCaminhoRelativo(path), type);
  if (erroDestino) return `Erro: ${erroDestino}`;

  const fm = args.frontmatter;
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    return "Erro: 'frontmatter' deve ser um objeto.";
  }
  const campos = fm as Record<string, unknown>;
  const erroGerenciado = erroCamposGerenciados(campos);
  if (erroGerenciado) return `Erro: ${erroGerenciado}`;

  const motivo = typeof args.motivo === "string" ? args.motivo.trim() : "";
  if (!motivo) return "Erro: 'motivo' e obrigatorio.";
  const naturezaProposta =
    args.natureza_proposta === "sintese_interpretativa"
      ? "sintese_interpretativa"
      : "explicita";
  if (args.natureza_proposta !== "explicita" && args.natureza_proposta !== "sintese_interpretativa") return "Erro: natureza_proposta inválida.";
  if (!Array.isArray(args.evidencias) || args.evidencias.length < 1 || args.evidencias.length > 4
    || args.evidencias.some((item) => typeof item !== "string" || !item.trim() || item.length > 240)) return "Erro: forneça de 1 a 4 evidências textuais, até 240 caracteres cada.";
  if (args.observacao_ids !== undefined && (!Array.isArray(args.observacao_ids)
    || args.observacao_ids.some((id) => typeof id !== "string" || !/^obs_\d{5}$/u.test(id)))) return "Erro: observacao_ids contém ID inválido.";
  const evidencias = Array.isArray(args.evidencias)
    ? args.evidencias
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const observationIds = Array.isArray(args.observacao_ids)
    ? [...new Set(args.observacao_ids
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => /^obs_\d{5}$/u.test(item)))]
    : [];
  const chatNovelty = interpretarNovidadeChat(args.avaliacao_novidade);
  if (typeof chatNovelty === "string") return `Erro: ${chatNovelty}`;
  const erroContexto = validarContextoCandidato({
    action: acao,
    memoryType: type,
    sourcePath: pathOrigem,
    observationIds,
    chatNovelty: chatNovelty?.classification,
  });
  if (erroContexto) return `Erro: ${erroContexto}`;
  if (evidencias.length === 0) return "Erro: forneça pelo menos uma evidência explícita.";

  let preparado;
  let baseRevision: string | undefined;
  try {
    const conteudoAtual = acao === "atualizar" && pathOrigem
      ? readFileSync(resolverCaminho(normalizarCaminhoRelativo(pathOrigem)), "utf8")
      : undefined;
    baseRevision = conteudoAtual === undefined ? undefined : revisaoMemoria(conteudoAtual);
    let catalogo: ReturnType<typeof carregarCatalogoMemoria> | undefined;
    const alteracoes = compilarInsercoes(type, args.alteracoes, (id) => {
      catalogo ??= carregarCatalogoMemoria();
      const matches = catalogo.filter((item) => item.id === id);
      const item = matches.length === 1 ? matches[0] : undefined;
      return item ? { id, type: item.type, title: item.title, path: item.path } : undefined;
    });
    preparado = preencherDocumentoCandidato({
      type,
      frontmatter: campos,
      alteracoes,
      conteudoAtual,
    });
  } catch (error) {
    return `Erro: ${error instanceof Error ? error.message : String(error)}`;
  }
  const erroData = erroDataNascimento(preparado.frontmatter, true);
  if (erroData) return `Erro: ${erroData}`;
  const erroReferencias = erroIntegridadeReferencias(preparado.frontmatter);
  if (erroReferencias) return `Erro: ${erroReferencias}`;

  const pathNormalizado = normalizarCaminhoRelativo(path);
  if (fila.some((item) => normalizarCaminhoRelativo(item.path) === pathNormalizado)) {
    return `Erro: já existe uma proposta nesta curadoria para "${pathNormalizado}". Integre os fatos em um único candidato.`;
  }

  const noveltyAssessments = observationIds.length
    ? obterAvaliacoesPara(observationIds)
    : chatNovelty
      ? [{
          observationId: "chat",
          memoryType: type,
          classification: chatNovelty.classification,
          reason: chatNovelty.reason,
        }]
      : [];
  fila.push({
    contractVersion: VERSAO_CONTRATO_ESCRITA,
    baseRevision,
    acao,
    pathOrigem,
    path,
    frontmatter: preparado.frontmatter,
    corpo: preparado.corpo,
    motivo,
    naturezaProposta,
    evidencias,
    observationIds,
    noveltyAssessments,
    consultedPaths: obterContextoConsultado(),
  });
  const mudanca =
    pathOrigem && caminhosDiferentes(pathOrigem, path)
      ? `; renomear ${pathOrigem} -> ${path}`
      : "";
  return `Candidato stageado (${acao}): ${path}${mudanca}`;
}

function interpretarNovidadeChat(value: unknown):
  | { classification: ClassificacaoNovidade; reason: string }
  | string
  | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "'avaliacao_novidade' deve ser um objeto.";
  }
  const item = value as Record<string, unknown>;
  const classification = item.classificacao;
  if (classification !== "nova" && classification !== "complementar" && classification !== "contradicao") {
    return "'avaliacao_novidade.classificacao' deve ser nova, complementar ou contradicao.";
  }
  const reason = typeof item.motivo === "string" ? item.motivo.trim() : "";
  if (!reason) return "'avaliacao_novidade.motivo' é obrigatório.";
  return { classification, reason: reason.slice(0, 500) };
}

/** Confere a mesma política de existência aplicada na escrita antes de
 * stagear. Assim o modelo recebe o erro e pode corrigir a proposta dentro do
 * próprio loop, antes de ela chegar à revisão humana. */
export function validarAlvosCandidato(
  acao: AcaoCandidato,
  path: string,
  pathOrigem: string | undefined,
  existe: (pathNormalizado: string) => boolean = (pathNormalizado) =>
    existsSync(resolverCaminho(pathNormalizado)),
): string | null {
  let destino: string;
  let origem: string | undefined;
  try {
    destino = normalizarCaminhoRelativo(path);
    origem = pathOrigem ? normalizarCaminhoRelativo(pathOrigem) : undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (acao === "criar" && existe(destino)) {
    return `já existe "${destino}". Leia o arquivo e reapresente a proposta como atualizar.`;
  }
  if (acao === "atualizar") {
    const origemFinal = origem ?? destino;
    if (!existe(origemFinal)) {
      return `não existe "${origemFinal}". Localize o arquivo correto ou use criar.`;
    }
    if (origemFinal !== destino && existe(destino)) {
      return `não é possível renomear para "${destino}": o destino já existe.`;
    }
  }
  return null;
}

/** O corpo nunca deve carregar um segundo frontmatter completo. */
export function limparFrontmatterDoCorpo(corpo: string): string {
  const semFrontmatter = corpo
    .replace(/^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
    .trim();
  return removerMarcadoresEvidencia(semFrontmatter);
}

/** IDs de fala/observação e timestamps de proveniência pertencem ao relatório
 * de revisão, nunca ao Markdown permanente. Horários que fazem parte do fato
 * narrado (sem um ID interno ao lado) são preservados. */
export function removerMarcadoresEvidencia(corpo: string): string {
  return corpo
    .replace(/[ \t]*\([^()\r\n]*\b(?:fala|obs)_\d+\b[^()\r\n]*\)/giu, "")
    .replace(/[ \t]*\[[^\[\]\r\n]*\b(?:fala|obs)_\d+\b[^\[\]\r\n]*\]/giu, "")
    .replace(/[ \t]*(?:[-–—][ \t]*)?\b(?:fala|obs)_\d+\b(?:[ \t]*[,;][ \t]*\d{1,2}:\d{2}(?::\d{2})?)?/giu, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}

export function caminhosDiferentes(a: string, b: string): boolean {
  const comparar = (path: string): string =>
    path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "").toLowerCase();
  return comparar(a) !== comparar(b);
}
