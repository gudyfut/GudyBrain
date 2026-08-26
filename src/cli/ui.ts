import type { AgentEvent } from "../core/agent";
import type { Candidato } from "../tools/memoria/candidato";
import { caminhosDiferentes } from "../tools/memoria/candidato";

const colorido = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

export function cor(texto: string, ...codigos: string[]): string {
  return colorido ? `${codigos.join("")}${texto}${ansi.reset}` : texto;
}

export const tema = ansi;

export function titulo(texto: string): string {
  return cor(texto, ansi.bold, ansi.cyan);
}

export function separador(): string {
  const largura = Math.min(Math.max(process.stdout.columns ?? 72, 48), 88);
  return cor("─".repeat(largura), ansi.dim);
}

export function promptUsuario(): string {
  return cor("Você › ", ansi.bold, ansi.cyan);
}

export function cabecalho(modelo: string): string {
  return [
    `${cor("Gudman", ansi.bold, ansi.cyan)} ${cor(`· ${modelo}`, ansi.dim)}`,
    `${cor("/ajuda", ansi.cyan)} para ver os comandos.`,
  ].join("\n");
}

let telaRevisaoAtiva = false;

/** Usa o buffer alternativo do terminal para não misturar revisão e conversa. */
export function entrarTelaRevisao(): void {
  if (process.stdout.isTTY) {
    telaRevisaoAtiva = true;
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
  }
}

export function limparTelaRevisao(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
}

export function sairTelaRevisao(): void {
  if (process.stdout.isTTY && telaRevisaoAtiva) {
    telaRevisaoAtiva = false;
    process.stdout.write("\x1b[?1049l");
  }
}

// Garante a restauração do terminal também em Ctrl+C/encerramento inesperado.
process.once("exit", sairTelaRevisao);

const ROTACAO = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Mantém a atividade do agente em uma única linha, sem poluir o histórico. */
export function criarIndicador(modo: "conversa" | "curadoria") {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let texto = modo === "curadoria" ? "Analisando a conversa" : "Pensando";
  let propostas = 0;

  const desenhar = (): void => {
    if (!process.stdout.isTTY) return;
    const icone = ROTACAO[frame++ % ROTACAO.length] ?? "·";
    process.stdout.write(`\r${cor(icone, ansi.cyan)} ${cor(texto, ansi.dim)}\x1b[K`);
  };

  const iniciar = (): void => {
    if (!process.stdout.isTTY || timer) return;
    desenhar();
    timer = setInterval(desenhar, 90);
  };

  const parar = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  };

  const evento = (event: AgentEvent): void => {
    if (event.type === "thinking") {
      iniciar();
      return;
    }
    if (event.type === "tool_call") {
      if (event.name === "memoria_preparar_candidato") propostas++;
      texto = descricaoFerramenta(event.name, modo, propostas);
      if (process.env.GUDMAN_DEBUG === "1" || process.env.GUDY_DEBUG === "1") {
        parar();
        console.log(cor(`[ferramenta] ${event.name} ${JSON.stringify(event.args)}`, ansi.dim));
        iniciar();
      }
      return;
    }
    if (event.type === "answer" || event.type === "max_steps") parar();
  };

  return { evento, parar };
}

function descricaoFerramenta(
  nome: string,
  modo: "conversa" | "curadoria",
  propostas: number,
): string {
  if (nome === "memoria_preparar_candidato") {
    return `${propostas} ${propostas === 1 ? "proposta preparada" : "propostas preparadas"}`;
  }
  if (nome === "memoria_listar") return "Consultando o índice da memória";
  if (nome === "memoria_buscar") return "Buscando contexto relevante";
  if (nome === "memoria_ler") return "Lendo contexto relevante";
  if (nome === "memoria_template") return "Preparando a estrutura da proposta";
  if (nome === "hora") return "Consultando a hora";
  return modo === "curadoria" ? "Analisando a conversa" : "Usando uma ferramenta";
}

export function cartãoCandidato(
  candidato: Candidato,
  indice: number,
  total: number,
  expandido = false,
): string {
  const acao = candidato.acao === "criar" ? "ADIÇÃO" : "ATUALIZAÇÃO";
  const corAcao = candidato.acao === "criar" ? ansi.green : ansi.yellow;
  const fm = Object.entries(candidato.frontmatter);
  const larguraChave = Math.min(Math.max(0, ...fm.map(([chave]) => chave.length)), 18);
  const linhas: string[] = [
    separador(),
    `${cor(`PROPOSTA ${indice + 1}/${total}`, ansi.bold)}  ${cor(acao, ansi.bold, corAcao)}`,
  ];

  const renomear = Boolean(
    candidato.pathOrigem && caminhosDiferentes(candidato.pathOrigem, candidato.path),
  );
  if (renomear && candidato.pathOrigem) {
    linhas.push(
      `${cor("arquivo atual", ansi.dim)}  ${candidato.pathOrigem}`,
      `${cor("arquivo final", ansi.dim)}  ${candidato.path}`,
      cor("O arquivo será renomeado se esta atualização for aprovada.", ansi.yellow),
    );
  } else {
    linhas.push(cor(candidato.path, ansi.cyan));
  }

  if (candidato.motivo) linhas.push("", `${cor("Por quê", ansi.bold)}  ${candidato.motivo}`);
  if (candidato.noveltyAssessments.length) {
    linhas.push("", cor("Comparação com a memória", ansi.bold));
    linhas.push(...candidato.noveltyAssessments.map((item) =>
      `  • ${item.classification}${item.comparedPath ? ` · ${item.comparedPath}` : ""} — ${item.reason}`));
  }

  const origem = candidato.naturezaProposta === "sintese_interpretativa"
    ? "Síntese interpretativa"
    : "Informação explícita";
  linhas.push("", `${cor("Origem", ansi.bold)}  ${origem}`);
  if (candidato.evidencias.length) {
    linhas.push(cor("EVIDÊNCIAS NA CONVERSA", ansi.bold, ansi.dim));
    linhas.push(...candidato.evidencias.map((evidencia) => `  • ${evidencia}`));
  }

  if (fm.length) {
    linhas.push("", cor("DADOS PROPOSTOS", ansi.bold, ansi.dim));
    for (const [chave, valor] of fm) {
      linhas.push(`  ${cor(chave.padEnd(larguraChave), ansi.dim)}  ${formatarValor(valor)}`);
    }
  }

  const corpo = candidato.corpo.trim();
  if (corpo) {
    const todas = corpo.split(/\r?\n/);
    const limite = expandido ? todas.length : 10;
    const rotuloCorpo = candidato.acao === "atualizar"
      ? "CONTEÚDO FINAL APÓS ATUALIZAÇÃO"
      : "CONTEÚDO PROPOSTO";
    linhas.push("", cor(rotuloCorpo, ansi.bold, ansi.dim));
    linhas.push(...todas.slice(0, limite).map((linha) => `  ${linha}`));
    if (todas.length > limite) {
      linhas.push(cor(`  … mais ${todas.length - limite} linha(s) — use [d] para expandir`, ansi.dim));
    }
  }

  linhas.push(separador());
  return linhas.join("\n");
}

function formatarValor(valor: unknown): string {
  if (Array.isArray(valor)) return valor.map(String).join(", ");
  if (valor && typeof valor === "object") return JSON.stringify(valor);
  return String(valor ?? "");
}

export function placarRevisao(
  aceitos: number,
  rejeitados: number,
  pendentes: number,
  erros = 0,
): string {
  return [
    cor(`${aceitos} aprovado(s)`, ansi.green),
    cor(`${rejeitados} rejeitado(s)`, ansi.red),
    erros ? cor(`${erros} com erro`, ansi.red) : "",
    pendentes ? cor(`${pendentes} não revisado(s)`, ansi.yellow) : "",
  ].filter(Boolean).join(" · ");
}

export type StatusRevisao = "aprovado" | "rejeitado" | "erro" | "pendente";

export interface ItemRelatorioRevisao {
  readonly candidato: Candidato;
  readonly status: StatusRevisao;
  readonly detalhe?: string;
}

export function relatorioRevisao(itens: ItemRelatorioRevisao[]): string {
  return itens.map(({ candidato, status, detalhe }) => {
    const acao = candidato.acao === "criar" ? "ADIÇÃO" : "ATUALIZAÇÃO";
    const estado = {
      aprovado: { icone: "✓", texto: "aprovada", codigo: ansi.green },
      rejeitado: { icone: "×", texto: "rejeitada", codigo: ansi.red },
      erro: { icone: "!", texto: "não aplicada", codigo: ansi.red },
      pendente: { icone: "·", texto: "não revisada", codigo: ansi.yellow },
    }[status];
    const origem = candidato.pathOrigem;
    const renomear = Boolean(origem && caminhosDiferentes(origem, candidato.path));
    const caminho = renomear ? `${origem} → ${candidato.path}` : candidato.path;
    const notaRenomeacao = renomear
      ? status === "aprovado"
        ? " · arquivo renomeado"
        : " · renomeação não aplicada"
      : "";
    const notaErro = detalhe ? ` · ${detalhe}` : "";
    return `${cor(`[${acao}]`, ansi.bold)} ${cor(estado.icone, estado.codigo)} ${estado.texto}: ${caminho}${notaRenomeacao}${notaErro}`;
  }).join("\n");
}
