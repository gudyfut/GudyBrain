import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolverCaminho } from "./caminhos";
import { erroDataNascimento } from "./datas";
import { criarIdMemoria, extrairIdMemoria, idMemoriaValido } from "./ids";
import { erroSchemaAtualizacao, erroSchemaCriacao } from "./schema";
import { erroEstruturaCorpo } from "./estrutura";
import { erroIntegridadeReferencias } from "./referencias";
import { parseFrontmatter } from "./frontmatter";

/**
 * Skills de escrita no bundle: memoria_criar e memoria_atualizar.
 *
 * A IA nunca toca no disco: ela devolve um tool_call com {path, frontmatter,
 * corpo} e este handler faz o fs. Validacao minima: so path (seguranca +
 * normalizacao de slug) e presenca de `type`. Nao restringimos valores de
 * natureza/tipo/categoria — o modelo pode usar os que quiser.
 *
 * Politica de conflito: criar recusa se ja existe; atualizar recusa se nao
 * existe. ID, proveniencia (generated) e status sao gerenciados pelo handler.
 */

interface Alvo {
  readonly dir: string;
  readonly file: string;
  readonly rel: string;
}

export interface WriteMemoryOptions {
  readonly generatedBy?: string;
}

// ---------------------------------------------------------------------------

/** Handler da skill memoria_criar. Cria conceito novo; recusa se ja existe. */
export async function memoriaCriar(
  args: Record<string, unknown>,
  options: WriteMemoryOptions = {},
): Promise<string> {
  const pathArg = typeof args.path === "string" ? args.path : "";
  if (!pathArg) return "Erro: 'path' e obrigatorio.";

  const fm = args.frontmatter;
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    return "Erro: 'frontmatter' deve ser um objeto com pelo menos 'type'.";
  }
  const campos = fm as Record<string, unknown>;
  if (typeof campos.type !== "string" || !campos.type.trim()) {
    return "Erro: frontmatter precisa de 'type' (nao vazio).";
  }
  const erroSchema = erroSchemaCriacao(campos);
  if (erroSchema) return `Erro: ${erroSchema}`;
  const erroData = erroDataNascimento(campos, true);
  if (erroData) return `Erro: ${erroData}`;
  const erroReferencias = erroIntegridadeReferencias(campos);
  if (erroReferencias) return `Erro: ${erroReferencias}`;
  const corpo = typeof args.corpo === "string" ? args.corpo : "";
  const erroEstrutura = erroEstruturaCorpo(campos.type, corpo);
  if (erroEstrutura) return `Erro: estrutura do corpo inválida: ${erroEstrutura}`;

  let alvo: Alvo;
  try {
    alvo = normalizarCaminho(pathArg);
  } catch (e) {
    return `Erro: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (existsSync(alvo.file)) {
    return `Erro: ja existe "${alvo.rel}". Use memoria_atualizar para modificar.`;
  }

  const id = criarIdUnico();
  mkdirSync(alvo.dir, { recursive: true });
  escreverAtomico(alvo.file, montarArquivoNovo(campos, corpo, id, options.generatedBy));
  return `Criado: ${alvo.rel}`;
}

/** Handler da skill memoria_atualizar. Mescla frontmatter e/ou troca o corpo.
 * Se path_origem difere de path, também renomeia o arquivo após aprovação. */
export async function memoriaAtualizar(
  args: Record<string, unknown>,
  options: WriteMemoryOptions = {},
): Promise<string> {
  const pathArg = typeof args.path === "string" ? args.path : "";
  if (!pathArg) return "Erro: 'path' e obrigatorio.";
  const pathOrigemArg =
    typeof args.path_origem === "string" && args.path_origem.trim()
      ? args.path_origem
      : pathArg;

  const fm = args.frontmatter;
  const temFm = !!fm && typeof fm === "object" && !Array.isArray(fm);
  const temCorpo = typeof args.corpo === "string";
  if (!temFm && !temCorpo) {
    return "Erro: forneca 'frontmatter' (mesclar) e/ou 'corpo' (substituir).";
  }
  if (temFm) {
    const erroData = erroDataNascimento(fm as Record<string, unknown>);
    if (erroData) return `Erro: ${erroData}`;
  }

  let origem: Alvo;
  let destino: Alvo;
  try {
    origem = normalizarCaminho(pathOrigemArg);
    destino = normalizarCaminho(pathArg);
  } catch (e) {
    return `Erro: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!existsSync(origem.file)) {
    return `Erro: nao existe "${origem.rel}". Use memoria_criar para criar.`;
  }
  const renomear = origem.file !== destino.file;
  if (renomear && existsSync(destino.file)) {
    return `Erro: nao e possivel renomear para "${destino.rel}": o arquivo ja existe.`;
  }

  const { frontmatter, corpo } = splitFrontmatter(
    readFileSync(origem.file, "utf8"),
  );
  const idAtual = extrairIdMemoria(frontmatter);
  if (!idMemoriaValido(idAtual)) {
    return `Erro: memória existente "${origem.rel}" não possui um id válido.`;
  }
  if (contarIdNoBundle(idAtual) !== 1) {
    return `Erro: id duplicado no bundle: "${idAtual}".`;
  }
  if (temFm) {
    const typeAtual = frontmatter.match(/^\s*type\s*:\s*([^\r\n]+)/m)?.[1]?.trim() ?? "";
    const erroSchema = erroSchemaAtualizacao(fm as Record<string, unknown>, typeAtual);
    if (erroSchema) return `Erro: ${erroSchema}`;
  }

  let fmFinal = frontmatter;
  if (temFm) fmFinal = mesclarLinhas(frontmatter, fm as Record<string, unknown>);
  fmFinal = reinjetarGenerated(fmFinal, options.generatedBy);

  const corpoFinal = temCorpo ? (args.corpo as string) : corpo;
  const typeFinal = fmFinal.match(/^\s*type\s*:\s*([^\r\n]+)/m)?.[1]?.trim() ?? "";
  const camposFinais = parseFrontmatterSimples(fmFinal);
  const erroReferencias = erroIntegridadeReferencias(camposFinais);
  if (erroReferencias) return `Erro: ${erroReferencias}`;
  const erroEstrutura = erroEstruturaCorpo(typeFinal, corpoFinal, corpo);
  if (erroEstrutura) return `Erro: estrutura do corpo inválida: ${erroEstrutura}`;
  const conteudoFinal = `---\n${fmFinal}\n---\n\n${corpoFinal.trim()}\n`;
  if (renomear) {
    mkdirSync(destino.dir, { recursive: true });
    renameSync(origem.file, destino.file);
  }
  escreverAtomico(destino.file, conteudoFinal);
  if (!renomear) return `Atualizado: ${destino.rel}`;

  const linksAtualizados = atualizarReferencias(origem.rel, destino.rel);
  return `Atualizado e renomeado: ${origem.rel} -> ${destino.rel} (${linksAtualizados} link(s) atualizado(s))`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valida o path (bloqueia ..) e normaliza cada segmento pra kebab-case sem
 *  acento. Retorna dir absoluto, file absoluto (.md) e path relativo. */
function normalizarCaminho(rel: string): Alvo {
  const relFinal = normalizarCaminhoRelativo(rel);
  const partes = relFinal.split("/");
  const arquivo = partes.pop();
  if (!arquivo) throw new Error("path vazio");
  const relPastas = partes.join("/");
  const dir = resolverCaminho(relPastas);
  return { dir, file: join(dir, arquivo), rel: relFinal };
}

function parseFrontmatterSimples(frontmatter: string): Record<string, unknown> {
  const conteudo = `---\n${frontmatter}\n---\n`;
  // Import local evitado: o parser do bundle já cobre escalares e listas inline.
  return parseFrontmatter(conteudo).campos;
}

/** Normalização pública para testes e para manter paths com/sem .md idênticos. */
export function normalizarCaminhoRelativo(rel: string): string {
  const limpo = rel.trim().replace(/^\/+|\/+$/g, "");
  if (limpo.includes("..")) throw new Error("path invalido (contem '..')");

  const crus = limpo.split("/").filter((s) => s.trim().length > 0);
  const ultimoCru = crus.pop();
  if (!ultimoCru) throw new Error("path vazio");
  const nome = normalizarSegmento(ultimoCru.replace(/\.md$/i, ""));
  if (!nome) throw new Error("nome de arquivo vazio");
  const pastas = crus.map(normalizarSegmento).filter(Boolean);
  return [...pastas, `${nome}.md`].join("/");
}

function normalizarSegmento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Serializa valor YAML simples (escalar, lista inline). Nao e YAML completo. */
function serializarValor(v: unknown): string {
  if (typeof v === "string") {
    if (v === "" || /[:\[\]{}#]/.test(v) || v !== v.trim()) return JSON.stringify(v);
    return v;
  }
  if (Array.isArray(v)) {
    const items = v.map((x) => {
      const s = typeof x === "string" ? x : String(x);
      return /[\[\],:]/.test(s) ? JSON.stringify(s) : s;
    });
    return `[${items.join(", ")}]`;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (v === undefined) return '""';
  return JSON.stringify(v);
}

function linhaGenerated(generatedBy = "gudman/desconhecido"): string {
  const by = generatedBy;
  const at = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  return `generated: { by: ${by}, at: ${at} }`;
}

/** Monta o arquivo novo: frontmatter com type primeiro, status default draft,
 *  generated injetado. */
function montarArquivoNovo(
  campos: Record<string, unknown>,
  corpo: string,
  id: string,
  generatedBy?: string,
): string {
  const linhas: string[] = [
    `type: ${serializarValor(campos.type)}`,
    `id: ${id}`,
  ];
  let temStatus = false;
  for (const [k, v] of Object.entries(campos)) {
    if (k === "type" || k === "id" || k === "generated") continue;
    if (k === "status") temStatus = true;
    linhas.push(`${k}: ${serializarValor(v)}`);
  }
  if (!temStatus) linhas.push("status: draft");
  linhas.push(linhaGenerated(generatedBy));
  return `---\n${linhas.join("\n")}\n---\n\n${corpo.trim()}\n`;
}

/** Separa o arquivo em texto do frontmatter (entre os ---) e corpo. */
function splitFrontmatter(conteudo: string): { frontmatter: string; corpo: string } {
  const m = conteudo.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!m || m[1] === undefined || m[2] === undefined) {
    return { frontmatter: "", corpo: conteudo };
  }
  return { frontmatter: m[1], corpo: m[2] };
}

/** Mescla `parcial` no texto do frontmatter existente (linha a linha):
 *  sobrepoa chaves existentes, mantem as demais, acrescenta as novas. */
function mesclarLinhas(fmText: string, parcial: Record<string, unknown>): string {
  const pendentes = new Set(Object.keys(parcial));
  const out: string[] = [];
  for (const linha of fmText.split(/\r?\n/)) {
    const m = linha.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    const chave = m?.[2];
    if (chave && pendentes.has(chave)) {
      out.push(`${m?.[1] ?? ""}${chave}: ${serializarValor(parcial[chave])}`);
      pendentes.delete(chave);
    } else {
      out.push(linha);
    }
  }
  for (const k of pendentes) out.push(`${k}: ${serializarValor(parcial[k])}`);
  return out.join("\n");
}

/** Remove qualquer linha `generated:` e reinsere uma fresca (atualiza by/at). */
function reinjetarGenerated(fmText: string, generatedBy?: string): string {
  const out = fmText.split(/\r?\n/).filter((l) => !/^\s*generated\s*:/.test(l));
  out.push(linhaGenerated(generatedBy));
  return out.join("\n");
}

/** Escreve em .tmp e renomeia — evita arquivo parcial se falhar no meio. */
function escreverAtomico(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function criarIdUnico(): string {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const id = criarIdMemoria();
    if (contarIdNoBundle(id) === 0) return id;
  }
  throw new Error("não foi possível gerar um id de memória único");
}

function contarIdNoBundle(id: string): number {
  const arquivos: string[] = [];
  coletarMarkdown(resolverCaminho(""), arquivos);
  let total = 0;
  for (const arquivo of arquivos) {
    const frontmatter = splitFrontmatter(readFileSync(arquivo, "utf8")).frontmatter;
    if (extrairIdMemoria(frontmatter) === id) total++;
  }
  return total;
}

/** Atualiza backlinks depois de uma renomeação para preservar o grafo. */
function atualizarReferencias(pathAntigo: string, pathNovo: string): number {
  const arquivos: string[] = [];
  coletarMarkdown(resolverCaminho(""), arquivos);
  let substituicoes = 0;
  for (const file of arquivos) {
    const atual = readFileSync(file, "utf8");
    const ocorrencias = atual.split(pathAntigo).length - 1;
    if (ocorrencias === 0) continue;
    escreverAtomico(file, atual.split(pathAntigo).join(pathNovo));
    substituicoes += ocorrencias;
  }
  return substituicoes;
}

function coletarMarkdown(dir: string, arquivos: string[]): void {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith(".")) continue;
    const full = join(dir, nome);
    const stat = statSync(full);
    if (stat.isDirectory()) coletarMarkdown(full, arquivos);
    else if (nome.endsWith(".md")) arquivos.push(full);
  }
}
