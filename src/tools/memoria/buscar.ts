import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { resolverCaminho, relativoDoBundle } from "./caminhos";
import { parseFrontmatter, normalizar } from "./frontmatter";
import { idMemoriaValido } from "./ids";
import { registrarBusca } from "./contextualizacao";

/**
 * Skill memoria_buscar: encontra conceitos no bundle por texto livre e/ou
 * filtros estruturados (type, natureza, tag, estado e referências por ID).
 * Retorna lista curta com identificação e trecho. Busca sem acento/case-insensitive.
 */
interface Resultado {
  readonly path: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly natureza?: string;
  readonly categoria?: string;
  readonly vinculo?: string;
  readonly proximidade?: number;
  readonly afinidade?: number;
  readonly temDataNascimento: boolean;
  readonly type?: string;
  readonly estado?: string;
  readonly participantes: readonly string[];
  readonly trecho: string;
}

const MAX_RESULTADOS = 20;

export async function memoriaBuscar(
  args: Record<string, unknown>,
): Promise<string> {
  const consulta = typeof args.consulta === "string" ? args.consulta.trim() : "";
  const pasta = typeof args.pasta === "string" ? args.pasta.trim() : "";
  const fType = typeof args.type === "string" ? args.type.trim() : "";
  const fId = typeof args.id === "string" ? args.id.trim() : "";
  const fNatureza = typeof args.natureza === "string" ? args.natureza.trim() : "";
  const fTag = typeof args.tag === "string" ? args.tag.trim() : "";
  const fCategoria = typeof args.categoria === "string" ? args.categoria.trim() : "";
  const fVinculo = typeof args.vinculo === "string" ? args.vinculo.trim() : "";
  const fEstado = typeof args.estado === "string" ? args.estado.trim() : "";
  const fRelacionadoId = typeof args.relacionado_a_id === "string" ? args.relacionado_a_id.trim() : "";
  const filtrosSociais = lerFiltrosSociais(args);
  if (typeof filtrosSociais === "string") return `Erro nos filtros: ${filtrosSociais}`;
  if (fId && !idMemoriaValido(fId)) return "Erro nos filtros: 'id' de memória inválido.";
  if (fRelacionadoId && !idMemoriaValido(fRelacionadoId)) {
    return "Erro nos filtros: 'relacionado_a_id' de memória inválido.";
  }
  const limites = filtrosSociais.limites;
  const temDataNascimento =
    typeof args.tem_data_nascimento === "boolean" ? args.tem_data_nascimento : undefined;
  const ordenarPor =
    typeof args.ordenar_por === "string" ? args.ordenar_por : filtrosSociais.ordenarPorPadrao;
  const ordem = args.ordem === "asc" ? "asc" : "desc";
  if (ordenarPor && !["proximidade", "afinidade", "title"].includes(ordenarPor)) {
    return "Erro nos filtros: 'ordenar_por' deve ser proximidade, afinidade ou title.";
  }

  if (!consulta && !fId && !fType && !fNatureza && !fTag && !fCategoria && !fVinculo && !fEstado && !fRelacionadoId &&
      !limites.ativos && temDataNascimento === undefined) {
    return "Consulta vazia. Passe 'consulta' (texto) e/ou algum filtro estruturado.";
  }

  const raiz = resolverCaminho(pasta);
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) {
    return `Pasta nao encontrada: "${pasta || "/"}".`;
  }

  const arquivos: string[] = [];
  coletarMd(raiz, arquivos);

  const qNorm = consulta ? normalizar(consulta) : "";
  const resultados: Resultado[] = [];

  for (const arq of arquivos) {
    const conteudo = readFileSync(arq, "utf8");
    const { campos, corpo } = parseFrontmatter(conteudo);

    if (fId && campos.id !== fId) continue;

    if (fType) {
      const v = campos.type;
      if (typeof v !== "string" || normalizar(v) !== normalizar(fType)) continue;
    }
    if (fNatureza) {
      const v = campos.natureza;
      if (typeof v !== "string" || normalizar(v) !== normalizar(fNatureza)) continue;
    }
    if (fTag) {
      const tags = Array.isArray(campos.tags) ? campos.tags : [];
      if (!tags.some((t) => normalizar(t) === normalizar(fTag))) continue;
    }
    if (fCategoria) {
      const valor = campos.categoria;
      if (typeof valor !== "string" || normalizar(valor) !== normalizar(fCategoria)) continue;
    }
    if (fVinculo) {
      const valor = campos.vinculo;
      if (typeof valor !== "string" || normalizar(valor) !== normalizar(fVinculo)) continue;
    }
    if (fEstado) {
      const valor = campos.estado;
      if (typeof valor !== "string" || normalizar(valor) !== normalizar(fEstado)) continue;
    }
    if (fRelacionadoId) {
      const references = ["participantes", "membros", "lugares"]
        .flatMap((field) => Array.isArray(campos[field]) ? campos[field] as string[] : []);
      if (!references.includes(fRelacionadoId)) continue;
    }

    const proximidade = numeroCampo(campos.proximidade);
    const afinidade = numeroCampo(campos.afinidade);
    if (!dentroDoIntervalo(proximidade, limites.proximidadeMin, limites.proximidadeMax)) continue;
    if (!dentroDoIntervalo(afinidade, limites.afinidadeMin, limites.afinidadeMax)) continue;
    const possuiData = typeof campos.data_nascimento === "string";
    if (temDataNascimento !== undefined && possuiData !== temDataNascimento) continue;

    let trecho = "";
    if (qNorm) {
      if (!normalizar(conteudo).includes(qNorm)) continue;
      trecho = extrairTrecho(corpo, qNorm);
    }

    const titulo =
      (typeof campos.title === "string" && campos.title) || relativoDoBundle(arq);
    const descricao =
      typeof campos.description === "string" ? campos.description : "";

    resultados.push({
      path: relativoDoBundle(arq),
      titulo,
      descricao,
      natureza: typeof campos.natureza === "string" ? campos.natureza : undefined,
      categoria: typeof campos.categoria === "string" ? campos.categoria : undefined,
      vinculo: typeof campos.vinculo === "string" ? campos.vinculo : undefined,
      proximidade,
      afinidade,
      temDataNascimento: possuiData,
      type: typeof campos.type === "string" ? campos.type : undefined,
      estado: typeof campos.estado === "string" ? campos.estado : undefined,
      participantes: Array.isArray(campos.participantes) ? campos.participantes : [],
      trecho,
    });
  }

  ordenarResultados(resultados, ordenarPor, ordem);
  const limitados = resultados.slice(0, MAX_RESULTADOS);
  registrarBusca({
    type: fType,
    pasta,
    resultPaths: limitados.map((resultado) => resultado.path),
  });

  if (resultados.length === 0) {
    const alvo = consulta || `type=${fType} natureza=${fNatureza} tag=${fTag}`;
    return `Nada encontrado em "${pasta || "/"}" para: ${alvo}.`;
  }

  const linhas = limitados.map((r) => {
    const nat = r.natureza ? ` [${r.natureza}]` : "";
    const social = [
      r.categoria,
      r.vinculo,
      r.proximidade !== undefined ? `proximidade=${r.proximidade}` : "",
      r.afinidade !== undefined ? `afinidade=${r.afinidade}` : "",
    ].filter(Boolean);
    const socialStr = social.length ? ` [${social.join("; ")}]` : "";
    const structured = [
      r.type ? `type=${r.type}` : "",
      r.estado ? `estado=${r.estado}` : "",
      r.participantes.length ? `participantes=[${r.participantes.join(", ")}]` : "",
    ].filter(Boolean);
    const structuredStr = structured.length ? ` [${structured.join("; ")}]` : "";
    const desc = r.descricao ? ` - ${r.descricao}` : "";
    const trecho = r.trecho ? `\n    "...${r.trecho}..."` : "";
    return `- ${r.path} :: ${r.titulo}${nat}${socialStr}${structuredStr}${desc}${trecho}`;
  });
  const aviso =
    resultados.length >= MAX_RESULTADOS
      ? `\n(mostrando os primeiros ${MAX_RESULTADOS}; refine se precisar)`
      : "";
  return `${linhas.join("\n")}${aviso}`;
}

interface Limites {
  readonly proximidadeMin?: number;
  readonly proximidadeMax?: number;
  readonly afinidadeMin?: number;
  readonly afinidadeMax?: number;
  readonly ativos: boolean;
}

interface FiltrosSociais {
  readonly limites: Limites;
  readonly ordenarPorPadrao: "" | "proximidade" | "afinidade";
}

function lerFiltrosSociais(args: Record<string, unknown>): FiltrosSociais | string {
  const explicitos = lerLimites(args);
  if (typeof explicitos === "string") return explicitos;
  const valor = args.criterios_sociais;
  if (valor === undefined) return { limites: explicitos, ordenarPorPadrao: "" };
  if (!Array.isArray(valor) || !valor.every((item) => typeof item === "string")) {
    return "'criterios_sociais' deve ser uma lista de critérios válidos.";
  }
  if (explicitos.ativos) {
    return "não combine 'criterios_sociais' com limites numéricos; use critérios para linguagem natural ou números quando o usuário informar notas explícitas.";
  }

  const permitidos = new Set([
    "proxima", "muito_proxima", "mais_proximas", "distante",
    "boa_afinidade", "muita_afinidade", "mais_afinidade", "baixa_afinidade",
  ]);
  const derivados: Record<string, number> = {};
  let ordenarPorPadrao: FiltrosSociais["ordenarPorPadrao"] = "";
  for (const criterio of valor) {
    if (!permitidos.has(criterio)) return `critério social desconhecido: "${criterio}".`;
    if (criterio === "proxima") derivados.proximidade_min = Math.max(derivados.proximidade_min ?? 0, 3);
    if (criterio === "muito_proxima" || criterio === "mais_proximas") {
      derivados.proximidade_min = Math.max(derivados.proximidade_min ?? 0, 4);
    }
    if (criterio === "mais_proximas") ordenarPorPadrao = "proximidade";
    if (criterio === "distante") derivados.proximidade_max = 2;
    if (criterio === "boa_afinidade") derivados.afinidade_min = Math.max(derivados.afinidade_min ?? 0, 3);
    if (criterio === "muita_afinidade" || criterio === "mais_afinidade") {
      derivados.afinidade_min = Math.max(derivados.afinidade_min ?? 0, 4);
    }
    if (criterio === "mais_afinidade") ordenarPorPadrao = "afinidade";
    if (criterio === "baixa_afinidade") derivados.afinidade_max = 2;
  }
  const limites = lerLimites(derivados);
  return typeof limites === "string" ? limites : { limites, ordenarPorPadrao };
}

function lerLimites(args: Record<string, unknown>): Limites | string {
  const pares = [
    ["proximidade_min", "proximidadeMin"],
    ["proximidade_max", "proximidadeMax"],
    ["afinidade_min", "afinidadeMin"],
    ["afinidade_max", "afinidadeMax"],
  ] as const;
  const out: Record<string, number> = {};
  for (const [arg, campo] of pares) {
    if (!(arg in args)) continue;
    const valor = args[arg];
    if (!Number.isInteger(valor) || Number(valor) < 0 || Number(valor) > 5) {
      return `'${arg}' deve ser inteiro de 0 a 5.`;
    }
    out[campo] = Number(valor);
  }
  if ((out.proximidadeMin ?? 0) > (out.proximidadeMax ?? 5)) {
    return "proximidade_min não pode ser maior que proximidade_max.";
  }
  if ((out.afinidadeMin ?? 0) > (out.afinidadeMax ?? 5)) {
    return "afinidade_min não pode ser maior que afinidade_max.";
  }
  return { ...out, ativos: Object.keys(out).length > 0 };
}

function numeroCampo(valor: string | string[] | null | undefined): number | undefined {
  if (typeof valor !== "string" || valor.trim() === "") return undefined;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : undefined;
}

function dentroDoIntervalo(valor: number | undefined, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  if (valor === undefined) return false;
  return (min === undefined || valor >= min) && (max === undefined || valor <= max);
}

function ordenarResultados(
  resultados: Resultado[],
  campo: string,
  ordem: "asc" | "desc",
): void {
  if (!campo) return;
  const fator = ordem === "asc" ? 1 : -1;
  resultados.sort((a, b) => {
    if (campo === "title") return a.titulo.localeCompare(b.titulo, "pt-BR") * fator;
    const av = campo === "proximidade" ? a.proximidade : a.afinidade;
    const bv = campo === "proximidade" ? b.proximidade : b.afinidade;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return (av - bv) * fator;
  });
}

/** Coleta recursivamente todos os .md (exceto index.md) sob `dir`. */
function coletarMd(dir: string, out: string[]): void {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const nome of entradas) {
    if (nome.startsWith(".")) continue;
    const full = join(dir, nome);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      coletarMd(full, out);
    } else if (extname(nome) === ".md" && nome !== "index.md") {
      out.push(full);
    }
  }
}

function extrairTrecho(corpo: string, qNorm: string, janela = 80): string {
  const idx = normalizar(corpo).indexOf(qNorm);
  if (idx === -1) return "";
  const inicio = Math.max(0, idx - 20);
  const fim = Math.min(corpo.length, idx + janela);
  return corpo.slice(inicio, fim).replace(/\s+/g, " ").trim();
}
