import type { Interface } from "node:readline/promises";
import type { Message } from "../core/glm";
import { extrairCandidatosChat } from "../agents/curador-chat/index";
import { extrairCandidatosCall } from "../agents/curador-call/index";
import { AGENT_PROFILES } from "../agents/registry";
import { memoriaCriar, memoriaAtualizar } from "../tools/memoria/escrever";
import type { Candidato } from "../tools/memoria/candidato";
import {
  cartãoCandidato,
  cor,
  criarIndicador,
  entrarTelaRevisao,
  limparTelaRevisao,
  placarRevisao,
  relatorioRevisao,
  separador,
  sairTelaRevisao,
  tema,
  titulo,
  type ItemRelatorioRevisao,
} from "./ui";

export interface ReviewMemoryOptions {
  readonly rl: Interface;
  readonly history?: Message[];
  readonly callAnalysis?: string;
  readonly apiKey: string;
}

/** Executa a fronteira humana entre propostas do curador e escrita no bundle. */
export async function revisarMemoria(options: ReviewMemoryOptions): Promise<void> {
  if (!options.callAnalysis && (!options.history || options.history.length === 0)) {
    console.log(cor("Ainda não há conversa para analisar.\n", tema.dim));
    return;
  }

  console.log(`${separador()}\n${titulo("Revisão de memória")}\n`);
  const atividadeCuradoria = criarIndicador("curadoria");
  let candidatos: Candidato[];
  let resumoNovidade: Readonly<Record<string, number>> | null = null;
  try {
    if (options.callAnalysis) {
      const outcome = await extrairCandidatosCall({
          analysis: options.callAnalysis,
          apiKey: options.apiKey,
          onStep: atividadeCuradoria.evento,
        });
      candidatos = [...outcome.candidates];
      resumoNovidade = outcome.coverage.noveltySummary;
    } else {
      candidatos = await extrairCandidatosChat({
          history: options.history ?? [],
          apiKey: options.apiKey,
          onStep: atividadeCuradoria.evento,
        });
    }
  } catch (err) {
    atividadeCuradoria.parar();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cor(`Erro ao analisar a conversa: ${msg}\n`, tema.red));
    return;
  }
  atividadeCuradoria.parar();

  if (resumoNovidade && Object.keys(resumoNovidade).length) {
    const itens = Object.entries(resumoNovidade)
      .map(([classe, total]) => `${total} ${classe.replaceAll("_", " ")}`)
      .join(" · ");
    console.log(`${cor("Comparação com a memória", tema.dim)}: ${itens}\n`);
  }

  if (candidatos.length === 0) {
    console.log(cor("Nenhuma informação durável nova foi encontrada.\n", tema.dim));
    return;
  }

  console.log(`${candidatos.length} proposta(s) pronta(s). Revise uma por vez.`);
  let aceitos = 0;
  let rejeitados = 0;
  let erros = 0;
  const resultados: ItemRelatorioRevisao[] = [];

  entrarTelaRevisao();
  try {
    for (const [indice, candidato] of candidatos.entries()) {
      const decisao = await confirmarCandidato(
        options.rl,
        candidato,
        indice,
        candidatos.length,
      );
      if (decisao === "parar") break;
      if (!decisao) {
        rejeitados++;
        resultados.push({ candidato, status: "rejeitado" });
        continue;
      }

      const resposta = candidato.acao === "criar"
        ? await memoriaCriar({
            path: candidato.path,
            frontmatter: candidato.frontmatter,
            corpo: candidato.corpo,
          }, { generatedBy: `gudman/${options.callAnalysis ? AGENT_PROFILES.curadorCall.model : AGENT_PROFILES.curadorChat.model}` })
        : await memoriaAtualizar({
            path_origem: candidato.pathOrigem,
            path: candidato.path,
            frontmatter: candidato.frontmatter,
            corpo: candidato.corpo,
          }, { generatedBy: `gudman/${options.callAnalysis ? AGENT_PROFILES.curadorCall.model : AGENT_PROFILES.curadorChat.model}` });

      if (resposta.startsWith("Criado") || resposta.startsWith("Atualizado")) {
        aceitos++;
        resultados.push({ candidato, status: "aprovado" });
      } else {
        erros++;
        resultados.push({ candidato, status: "erro", detalhe: resposta });
        limparTelaRevisao();
        console.log(cor(`Não foi possível aplicar: ${resposta}`, tema.red));
        await options.rl.question("Pressione Enter para continuar › ");
      }
    }
  } finally {
    sairTelaRevisao();
  }

  const processados = new Set(resultados.map((item) => item.candidato));
  for (const candidato of candidatos) {
    if (!processados.has(candidato)) {
      resultados.push({ candidato, status: "pendente" });
    }
  }
  const pendentes = resultados.filter((item) => item.status === "pendente").length;
  console.log(
    `\n${titulo("Revisão concluída")} · ${placarRevisao(aceitos, rejeitados, pendentes, erros)}\n${relatorioRevisao(resultados)}\n`,
  );
}

async function confirmarCandidato(
  rl: Interface,
  candidato: Candidato,
  indice: number,
  total: number,
): Promise<boolean | "parar"> {
  let expandido = false;
  while (true) {
    limparTelaRevisao();
    console.log(`${titulo("Revisão de memória")}\n\n${cartãoCandidato(candidato, indice, total, expandido)}`);
    const resposta = (
      await rl.question(
        `${cor("[a]", tema.green)} aprovar  ${cor("[r]", tema.red)} rejeitar  ${cor("[d]", tema.cyan)} ${expandido ? "resumir" : "detalhes"}  ${cor("[q]", tema.yellow)} encerrar › `,
      )
    ).trim().toLowerCase();

    if (["q", "sair", "parar"].includes(resposta)) return "parar";
    if (["a", "aprovar", "sim", "s"].includes(resposta)) return true;
    if (["r", "rejeitar", "nao", "não", "n"].includes(resposta)) return false;
    if (["d", "detalhes", "resumir"].includes(resposta)) expandido = !expandido;
  }
}
