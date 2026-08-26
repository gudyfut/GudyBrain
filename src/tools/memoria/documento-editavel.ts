import { erroSchemaCriacao } from "./schema";
import { erroEstruturaCorpo } from "./estrutura";

const CAMPOS_GERENCIADOS = ["id", "status", "generated"] as const;

export interface DocumentoMemoriaEditavel {
  readonly campos: Record<string, unknown>;
  readonly corpo: string;
  readonly gerenciados: Record<string, string>;
}

/** Monta a versão integral que será comparada e editada na interface web. */
export function montarPreviaMemoria(
  atual: string,
  campos: Record<string, unknown>,
  corpo: string,
): string {
  if (!atual) {
    const linhas = Object.entries(campos).map(([chave, valor]) =>
      `${chave}: ${serializarValor(valor)}`);
    return `---\n${linhas.join("\n")}\n---\n\n${corpo.trim()}\n`;
  }

  const partes = separarDocumento(atual);
  const frontmatter = mesclarLinhas(partes.frontmatter, campos);
  return `---\n${frontmatter}\n---\n\n${corpo.trim()}\n`;
}

/** Lê o documento integral editado e devolve apenas campos controláveis. */
export function interpretarDocumentoEditavel(
  conteudo: string,
  atual?: string,
): DocumentoMemoriaEditavel {
  const documento = parseDocumento(conteudo);
  const erroSchema = erroSchemaCriacao(documento.campos);
  if (erroSchema) throw new Error(`Documento inválido: ${erroSchema}`);

  if (!atual) {
    const fornecidos = CAMPOS_GERENCIADOS.filter((campo) => campo in documento.gerenciados);
    if (fornecidos.length) {
      throw new Error(`Remova os campos gerenciados pelo sistema: ${fornecidos.join(", ")}.`);
    }
    const erroEstrutura = erroEstruturaCorpo(String(documento.campos.type ?? ""), documento.corpo);
    if (erroEstrutura) throw new Error(`Documento inválido: ${erroEstrutura}`);
    return documento;
  }

  const original = parseDocumento(atual);
  if (documento.campos.type !== original.campos.type) {
    throw new Error("O tipo de uma memória existente não pode ser alterado por esta tela.");
  }
  for (const campo of CAMPOS_GERENCIADOS) {
    if ((documento.gerenciados[campo] ?? "") !== (original.gerenciados[campo] ?? "")) {
      throw new Error(`O campo '${campo}' é gerenciado pelo sistema e não pode ser alterado.`);
    }
  }
  const erroEstrutura = erroEstruturaCorpo(
    String(documento.campos.type ?? ""),
    documento.corpo,
    original.corpo,
  );
  if (erroEstrutura) throw new Error(`Documento inválido: ${erroEstrutura}`);
  return documento;
}

function parseDocumento(conteudo: string): DocumentoMemoriaEditavel {
  const partes = separarDocumento(conteudo);
  const campos: Record<string, unknown> = {};
  const gerenciados: Record<string, string> = {};
  const vistos = new Set<string>();

  for (const linhaOriginal of partes.frontmatter.split(/\r?\n/)) {
    const linha = linhaOriginal.trim();
    if (!linha || linha.startsWith("#")) continue;
    const match = linha.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`Linha de frontmatter não suportada: ${linhaOriginal}`);
    }
    const chave = match[1];
    if (vistos.has(chave)) throw new Error(`Campo duplicado no frontmatter: ${chave}.`);
    vistos.add(chave);
    if ((CAMPOS_GERENCIADOS as readonly string[]).includes(chave)) {
      gerenciados[chave] = match[2].trim();
    } else {
      campos[chave] = interpretarValor(match[2].trim());
    }
  }
  return { campos, corpo: partes.corpo, gerenciados };
}

function separarDocumento(conteudo: string): { frontmatter: string; corpo: string } {
  const match = conteudo.replace(/^\uFEFF/, "").match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/,
  );
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error("A memória precisa começar e terminar o frontmatter com '---'.");
  }
  return { frontmatter: match[1], corpo: match[2] };
}

function interpretarValor(valor: string): unknown {
  if (valor === "null" || valor === "~") return null;
  if (valor === "true") return true;
  if (valor === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(valor)) return Number(valor);
  if (valor.startsWith("[") && valor.endsWith("]")) {
    return separarLista(valor.slice(1, -1)).map(interpretarEscalarTexto);
  }
  return interpretarEscalarTexto(valor);
}

function interpretarEscalarTexto(valor: string): string {
  const limpo = valor.trim();
  if (limpo.startsWith('"') && limpo.endsWith('"')) {
    try { return JSON.parse(limpo) as string; } catch { /* usa texto literal */ }
  }
  if (limpo.startsWith("'") && limpo.endsWith("'")) {
    return limpo.slice(1, -1).replace(/''/g, "'");
  }
  return limpo;
}

function separarLista(valor: string): string[] {
  if (!valor.trim()) return [];
  const itens: string[] = [];
  let atual = "";
  let aspas: "'" | '"' | null = null;
  let escape = false;
  for (const caractere of valor) {
    if (escape) { atual += caractere; escape = false; continue; }
    if (caractere === "\\" && aspas === '"') { atual += caractere; escape = true; continue; }
    if (caractere === "'" || caractere === '"') {
      if (aspas === caractere) aspas = null;
      else if (!aspas) aspas = caractere;
      atual += caractere;
      continue;
    }
    if (caractere === "," && !aspas) { itens.push(atual.trim()); atual = ""; continue; }
    atual += caractere;
  }
  if (aspas) throw new Error("Lista com aspas não fechadas no frontmatter.");
  itens.push(atual.trim());
  return itens.filter(Boolean);
}

function mesclarLinhas(frontmatter: string, parcial: Record<string, unknown>): string {
  const pendentes = new Set(Object.keys(parcial));
  const linhas = frontmatter.split(/\r?\n/).map((linha) => {
    const match = linha.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    const chave = match?.[2];
    if (!chave || !pendentes.has(chave)) return linha;
    pendentes.delete(chave);
    return `${match?.[1] ?? ""}${chave}: ${serializarValor(parcial[chave])}`;
  });
  for (const chave of pendentes) linhas.push(`${chave}: ${serializarValor(parcial[chave])}`);
  return linhas.join("\n");
}

function serializarValor(valor: unknown): string {
  if (typeof valor === "string") {
    if (!valor || /[:\[\]{}#]/.test(valor) || valor !== valor.trim()) return JSON.stringify(valor);
    return valor;
  }
  if (Array.isArray(valor)) {
    return `[${valor.map((item) => {
      const texto = String(item);
      return /[\[\],:#]/.test(texto) ? JSON.stringify(texto) : texto;
    }).join(", ")}]`;
  }
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (valor === null) return "null";
  return JSON.stringify(valor ?? "");
}
