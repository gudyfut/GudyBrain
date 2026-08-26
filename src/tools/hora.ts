/**
 * Handler da skill `hora`. Cada skill = 1 arquivo .md (descricao pro modelo)
 * + 1 funcao como esta (a execucao real). Ligacao pelo nome: o `name` no
 * frontmatter de src/agents/conversante/tools/hora.md precisa corresponder à
 * chave em src/tools/registry.ts.
 *
 * A funcao recebe os argumentos (ja parseados de JSON) e devolve uma string
 * que e devolvida ao modelo como resultado da ferramenta.
 */
export async function hora(args: Record<string, unknown>): Promise<string> {
  const fuso = typeof args.fuso === "string" ? args.fuso : undefined;

  const now = new Date();
  try {
    return now.toLocaleString("pt-BR", fuso ? { timeZone: fuso } : undefined);
  } catch {
    return `Fuso horario invalido: ${fuso ?? "(vazio)"}`;
  }
}
