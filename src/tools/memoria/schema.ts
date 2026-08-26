import { normalizar } from "./frontmatter";
import { obterEstruturaMemoria } from "./estrutura";
import { idMemoriaValido } from "./ids";

const TIPO_EVENTO_ANTERIOR_A_PERIODO = ["epo", "ca"].join("");

const CAMPOS_GERENCIADOS = ["id", "status", "generated"] as const;

/** Valida o conteúdo proposto; metadados estruturais são injetados depois. */
export function erroSchemaCriacao(
  campos: Record<string, unknown>,
): string | undefined {
  const type = typeof campos.type === "string" ? normalizar(campos.type.trim()) : "";
  const obrigatorios = obterEstruturaMemoria(type)?.campos;
  if (!obrigatorios) return `tipo desconhecido "${String(campos.type ?? "")}".`;

  const ausentes = obrigatorios.filter((campo) => !(campo in campos));
  if (ausentes.length) {
    return `frontmatter de ${campos.type} sem campo(s) obrigatório(s): ${ausentes.join(", ")}. Use null para valor desconhecido e [] para lista vazia.`;
  }

  const erroGerenciado = erroCamposGerenciados(campos);
  if (erroGerenciado) return erroGerenciado;

  const permitidos = new Set(obrigatorios);
  const extras = Object.keys(campos).filter((campo) => !permitidos.has(campo));
  if (extras.length) return `campo(s) fora do schema de ${campos.type}: ${extras.join(", ")}.`;

  if (typeof campos.title !== "string" || !campos.title.trim()) {
    return "'title' deve ser um texto não vazio.";
  }
  if (!Array.isArray(campos.tags)) return "'tags' deve ser uma lista; use [] quando vazia.";

  const erroReferencias = erroCamposReferencia(type, campos, true);
  if (erroReferencias) return erroReferencias;

  if (type === "pessoa") {
    if (campos.apelido !== null && typeof campos.apelido !== "string" && !Array.isArray(campos.apelido)) {
      return "'apelido' deve ser texto, lista ou null.";
    }
    if (campos.categoria !== null) {
      const categorias = ["familia", "amigo", "conhecido"];
      if (typeof campos.categoria !== "string" || !categorias.includes(normalizar(campos.categoria))) {
        return "'categoria' deve ser Familia, Amigo, Conhecido ou null.";
      }
    }
    for (const campo of ["proximidade", "afinidade"] as const) {
      const valor = campos[campo];
      if (valor !== null && (!Number.isInteger(valor) || Number(valor) < 0 || Number(valor) > 5)) {
        return `'${campo}' deve ser inteiro de 0 a 5 ou null.`;
      }
    }
  }
  if (type === "evento" && typeof campos.tipo === "string") {
    const legado = normalizar(campos.tipo);
    if (legado === "fase" || legado === TIPO_EVENTO_ANTERIOR_A_PERIODO || legado === "ocorrencia") {
      return `'tipo' de Evento usa Periodo ou Acontecimento; "${campos.tipo}" é um valor legado.`;
    }
  }
  if (type === "projeto") {
    const estados = ["ideia", "planejamento", "ativo", "pausado", "concluido", "cancelado"];
    if (campos.estado !== null && (
      typeof campos.estado !== "string" || !estados.includes(normalizar(campos.estado))
    )) {
      return "'estado' de Projeto deve ser Ideia, Planejamento, Ativo, Pausado, Concluido, Cancelado ou null.";
    }
    for (const campo of ["inicio", "fim"] as const) {
      const valor = campos[campo];
      if (valor !== null && (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/u.test(valor))) {
        return `'${campo}' de Projeto deve usar YYYY-MM-DD, YYYY-MM-DDTHH:mm ou null.`;
      }
    }
  }
  return undefined;
}

export function camposDoTipo(type: string): readonly string[] | undefined {
  return obterEstruturaMemoria(type)?.campos;
}

/** Validação defensiva de campos parciais numa atualização. */
export function erroSchemaAtualizacao(
  campos: Record<string, unknown>,
  typeAtual: string,
): string | undefined {
  const type = typeof campos.type === "string" ? campos.type : typeAtual;
  const permitidosDoTipo = camposDoTipo(type);
  if (!permitidosDoTipo) return `tipo desconhecido "${type}".`;
  const erroGerenciado = erroCamposGerenciados(campos);
  if (erroGerenciado) return erroGerenciado;
  const permitidos = new Set(permitidosDoTipo);
  const extras = Object.keys(campos).filter((campo) => !permitidos.has(campo));
  if (extras.length) return `campo(s) fora do schema de ${type}: ${extras.join(", ")}.`;
  const erroReferencias = erroCamposReferencia(normalizar(type), campos, false);
  if (erroReferencias) return erroReferencias;
  if (normalizar(type) === "evento" && typeof campos.tipo === "string") {
    const legado = normalizar(campos.tipo);
    if (legado === "fase" || legado === TIPO_EVENTO_ANTERIOR_A_PERIODO || legado === "ocorrencia") {
      return `'tipo' de Evento usa Periodo ou Acontecimento; "${campos.tipo}" é um valor legado.`;
    }
  }
  if (normalizar(type) === "projeto") {
    const completo = Object.fromEntries(
      (permitidosDoTipo ?? []).map((campo) => [campo, campo in campos ? campos[campo] : null]),
    );
    completo.type = "Projeto";
    completo.title = typeof completo.title === "string" && completo.title ? completo.title : "validação parcial";
    completo.tags = Array.isArray(completo.tags) ? completo.tags : [];
    completo.participantes = Array.isArray(completo.participantes) ? completo.participantes : [];
    const erro = erroSchemaCriacao(completo);
    if (erro) return erro;
  }
  return undefined;
}

const REFERENCES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  grupo: ["membros"],
  projeto: ["participantes"],
  evento: ["participantes", "lugares"],
};

function erroCamposReferencia(
  type: string,
  campos: Record<string, unknown>,
  required: boolean,
): string | undefined {
  for (const field of REFERENCES_BY_TYPE[type] ?? []) {
    if (!required && !(field in campos)) continue;
    const value = campos[field];
    if (!Array.isArray(value)) return `'${field}' deve ser uma lista de IDs de memória; use [] quando vazia.`;
    if (!value.every((item) => typeof item === "string" && idMemoriaValido(item))) {
      return `'${field}' deve conter somente IDs imutáveis no formato mem_<uuid-v4>.`;
    }
    if (new Set(value).size !== value.length) return `'${field}' não deve repetir IDs.`;
  }
  return undefined;
}

export function erroCamposGerenciados(
  campos: Record<string, unknown>,
): string | undefined {
  const presentes = CAMPOS_GERENCIADOS.filter((campo) => campo in campos);
  if (!presentes.length) return undefined;
  return `campo(s) gerenciado(s) pelo sistema não devem ser fornecidos: ${presentes.join(", ")}.`;
}
