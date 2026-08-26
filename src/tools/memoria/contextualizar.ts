import {
  buscarContextoMemoria,
  formatarPerfilIdentificacao,
} from "./catalogo";
import { registrarBusca } from "./contextualizacao";

/** Busca curta de candidatos semanticamente próximos antes da decisão do curador. */
export async function memoriaContextualizar(
  args: Record<string, unknown>,
): Promise<string> {
  const consulta = typeof args.consulta === "string" ? args.consulta.trim() : "";
  const tipoMemoria = typeof args.tipo_memoria === "string" ? args.tipo_memoria.trim() : "";
  const entidadeIds = listaStrings(args.entidade_ids);
  const pathsSugeridos = listaStrings(args.paths_sugeridos);
  if (!consulta && !tipoMemoria && !entidadeIds.length && !pathsSugeridos.length) {
    return "Erro: informe consulta, tipo_memoria, entidade_ids ou paths_sugeridos.";
  }
  const limite = Number.isInteger(args.limite) ? Number(args.limite) : 5;
  const results = buscarContextoMemoria({
    consulta,
    tipoMemoria,
    entidadeIds,
    pathsSugeridos,
    limite,
  });
  registrarBusca({
    type: tipoMemoria,
    resultPaths: results.map((result) => result.path),
  });
  if (!results.length) {
    return "Nenhuma memória existente parece corresponder ao contexto informado.";
  }
  return [
    "Correspondências contextuais (indícios; leia o destino antes de atualizar):",
    ...results.map((result) => [
      `- ${result.path} · score=${result.score} · ${result.reasons.join(", ")}`,
      `  ${formatarPerfilIdentificacao(result.identification)}`,
    ].join("\n")),
  ].join("\n");
}

function listaStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}
