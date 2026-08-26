import {
  erroConteudoSecao,
  nomeSecaoCanonica,
  normalizarTitulo,
  obterEstruturaMemoria,
} from "./estrutura";
import { interpretarDocumentoEditavel } from "./documento-editavel";
import { erroSchemaCriacao } from "./schema";

export interface AlteracaoSecao {
  readonly secao: string;
  readonly conteudo: string;
  readonly modo: "acrescentar" | "substituir";
}

export interface DocumentoCandidatoPreparado {
  readonly frontmatter: Record<string, unknown>;
  readonly corpo: string;
}

/** Transforma deltas semânticos do curador em um documento completo. O modelo
 * escolhe o destino da informação; títulos, ordem e preservação são do código. */
export function preencherDocumentoCandidato(options: {
  readonly type: string;
  readonly frontmatter: Record<string, unknown>;
  readonly alteracoes: readonly AlteracaoSecao[];
  readonly conteudoAtual?: string;
}): DocumentoCandidatoPreparado {
  const estrutura = obterEstruturaMemoria(options.type);
  if (!estrutura) throw new Error(`tipo desconhecido "${options.type}".`);

  const atual = options.conteudoAtual
    ? interpretarDocumentoEditavel(options.conteudoAtual, options.conteudoAtual)
    : undefined;
  if (atual && obterEstruturaMemoria(String(atual.campos.type ?? ""))?.type !== estrutura.type) {
    throw new Error(`o arquivo existente é ${String(atual.campos.type)}, não ${estrutura.type}.`);
  }

  const frontmatter: Record<string, unknown> = {};
  for (const campo of estrutura.campos) {
    if (campo === "type") frontmatter[campo] = estrutura.type;
    else if (campo in options.frontmatter) frontmatter[campo] = options.frontmatter[campo];
    else if (atual && campo in atual.campos) frontmatter[campo] = atual.campos[campo];
    else frontmatter[campo] = ["tags", "membros", "participantes", "lugares"].includes(campo)
      ? []
      : null;
  }
  const extras = Object.keys(options.frontmatter).filter((campo) => !estrutura.campos.includes(campo));
  if (extras.length) throw new Error(`campo(s) fora do schema de ${estrutura.type}: ${extras.join(", ")}.`);
  const erroSchema = erroSchemaCriacao(frontmatter);
  if (erroSchema) throw new Error(erroSchema);

  const blocos = atual
    ? dividirCorpo(atual.corpo)
    : estrutura.secoes.map((secao) => ({ titulo: secao.nome, conteudo: "" }));
  const vistos = new Set<string>();
  for (const alteracao of options.alteracoes) {
    const canonica = nomeSecaoCanonica(estrutura.type, alteracao.secao);
    if (!canonica) {
      throw new Error(`seção "${alteracao.secao}" não pertence a ${estrutura.type}. Use: ${estrutura.secoes.map((item) => item.nome).join(", ")}.`);
    }
    if (/^##[ \t]+/mu.test(alteracao.conteudo)) {
      throw new Error(`o conteúdo de "${canonica}" não pode criar outra seção de nível 2.`);
    }
    const erroConteudo = erroConteudoSecao(estrutura.type, canonica, alteracao.conteudo);
    if (erroConteudo) throw new Error(erroConteudo);
    const chave = normalizarTitulo(canonica);
    if (vistos.has(chave)) throw new Error(`a seção "${canonica}" foi enviada mais de uma vez.`);
    vistos.add(chave);

    let indice = blocos.findIndex((bloco) => normalizarTitulo(bloco.titulo) === chave);
    if (indice === -1) {
      indice = posicaoDeInsercao(blocos, estrutura.secoes.map((item) => item.nome), canonica);
      blocos.splice(indice, 0, { titulo: canonica, conteudo: "" });
    }
    const bloco = blocos[indice];
    if (!bloco) throw new Error(`não foi possível preparar a seção "${canonica}".`);
    bloco.titulo = canonica;
    bloco.conteudo = alteracao.modo === "substituir"
      ? alteracao.conteudo.trim()
      : estrutura.type === "Pessoa" && canonica === "Relações"
        ? mesclarRelacoes(bloco.conteudo, alteracao.conteudo)
        : mesclarConteudo(bloco.conteudo, alteracao.conteudo);
  }

  return { frontmatter, corpo: montarCorpo(blocos) };
}

interface BlocoCorpo {
  titulo: string;
  conteudo: string;
}

function dividirCorpo(markdown: string): BlocoCorpo[] {
  const blocos: BlocoCorpo[] = [];
  let titulo = "";
  let linhas: string[] = [];
  const flush = (): void => {
    const conteudo = linhas.join("\n").trim();
    if (titulo || conteudo) blocos.push({ titulo, conteudo });
  };
  for (const linha of markdown.trim().split(/\r?\n/)) {
    const match = linha.match(/^##[ \t]+(.+?)[ \t]*$/u);
    if (match?.[1]) {
      flush();
      titulo = match[1];
      linhas = [];
    } else {
      linhas.push(linha);
    }
  }
  flush();
  return blocos;
}

function montarCorpo(blocos: readonly BlocoCorpo[]): string {
  return normalizarEspacamentoCorpo(blocos
    .map((bloco) => bloco.titulo
      ? [`## ${bloco.titulo}`, bloco.conteudo].filter(Boolean).join("\n")
      : bloco.conteudo)
    .filter(Boolean)
    .join("\n\n")
    .trim());
}

/** Mantém o Markdown legível sem transformar espaçamento decorativo em
 * alterações revisáveis. Preserva uma linha entre parágrafos e seções, mas
 * elimina linhas vazias logo após H2 com conteúdo e entre itens consecutivos. */
export function normalizarEspacamentoCorpo(markdown: string): string {
  const linhas = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+$/u, ""));
  const resultado: string[] = [];

  for (let indice = 0; indice < linhas.length; indice++) {
    const linha = linhas[indice] ?? "";
    if (linha.trim()) {
      resultado.push(linha);
      continue;
    }

    const anterior = resultado.at(-1) ?? "";
    const proxima = linhas.slice(indice + 1).find((item) => item.trim()) ?? "";
    if (!anterior || !proxima || !anterior.trim()) continue;
    if (/^##[ \t]+/u.test(anterior) && !/^##[ \t]+/u.test(proxima)) continue;
    if (/^\s*[-*+]\s+/u.test(anterior) && /^\s*[-*+]\s+/u.test(proxima)) continue;
    resultado.push("");
  }

  return resultado.join("\n").trim();
}

function posicaoDeInsercao(
  blocos: readonly BlocoCorpo[],
  ordem: readonly string[],
  titulo: string,
): number {
  const alvo = ordem.findIndex((item) => item === titulo);
  for (let index = 0; index < blocos.length; index++) {
    const ordemExistente = ordem.findIndex(
      (item) => normalizarTitulo(item) === normalizarTitulo(blocos[index]?.titulo ?? ""),
    );
    if (ordemExistente > alvo) return index;
  }
  let ultimaCanonica = -1;
  for (let index = 0; index < blocos.length; index++) {
    if (ordem.some((item) => normalizarTitulo(item) === normalizarTitulo(blocos[index]?.titulo ?? ""))) {
      ultimaCanonica = index;
    }
  }
  return ultimaCanonica + 1;
}

function mesclarConteudo(atual: string, novo: string): string {
  const existente = atual.trim();
  const proposto = novo.trim();
  if (!proposto) return existente;
  if (!existente) return proposto;
  const normalizadoAtual = normalizarBloco(existente);
  const normalizadoNovo = normalizarBloco(proposto);
  if (normalizadoAtual.includes(normalizadoNovo)) return existente;
  if (normalizadoNovo.includes(normalizadoAtual)) return proposto;
  const separador = [...existente.split(/\r?\n/), ...proposto.split(/\r?\n/)]
    .every((linha) => !linha.trim() || /^\s*[-*+]\s+/u.test(linha))
      ? "\n"
      : "\n\n";
  return `${existente}${separador}${proposto}`;
}

interface BlocoRelacao {
  titulo: string;
  path: string;
  itens: string[];
}

/** Integra novas percepções no alvo já existente sem duplicar subtítulos. */
function mesclarRelacoes(atual: string, novo: string): string {
  const existentes = dividirRelacoes(atual);
  const propostos = dividirRelacoes(novo);
  const porPath = new Map(existentes.map((bloco) => [bloco.path, bloco]));

  for (const proposto of propostos) {
    const existente = porPath.get(proposto.path);
    if (!existente) {
      existentes.push(proposto);
      porPath.set(proposto.path, proposto);
      continue;
    }
    existente.titulo = proposto.titulo;
    const vistos = new Set(existente.itens.map(normalizarBloco));
    for (const item of proposto.itens) {
      const chave = normalizarBloco(item);
      if (!vistos.has(chave)) {
        existente.itens.push(item);
        vistos.add(chave);
      }
    }
  }

  return existentes
    .map((bloco) => [`### [${bloco.titulo}](${bloco.path})`, ...bloco.itens].join("\n"))
    .join("\n\n");
}

function dividirRelacoes(markdown: string): BlocoRelacao[] {
  if (!markdown.trim()) return [];
  const blocos: BlocoRelacao[] = [];
  let atual: BlocoRelacao | undefined;
  for (const linhaBruta of markdown.trim().split(/\r?\n/u)) {
    const linha = linhaBruta.trim();
    if (!linha) continue;
    const titulo = linha.match(/^### \[([^\]\r\n]+)\]\((\/social\/pessoas\/[a-z0-9-]+\.md)\)$/u);
    if (titulo?.[1] && titulo[2]) {
      atual = { titulo: titulo[1], path: titulo[2], itens: [] };
      blocos.push(atual);
      continue;
    }
    if (!atual || !/^- \S/u.test(linha)) {
      throw new Error("Relações existentes não seguem o formato canônico; substitua a seção para migrá-la antes de acrescentar conteúdo.");
    }
    atual.itens.push(linha);
  }
  return blocos;
}

function normalizarBloco(value: string): string {
  return normalizarTitulo(value).replace(/\s+/g, " ");
}
