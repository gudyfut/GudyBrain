/** Valida uma data civil completa em ISO (YYYY-MM-DD), sem aceitar correções
 * automáticas do Date, como transformar 30/02 em uma data de março. */
export function dataIsoValida(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const match = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;

  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const diasPorMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= (diasPorMes[mes - 1] ?? 0);
}

export function erroDataNascimento(
  campos: Record<string, unknown>,
  exigirEmPessoa = false,
): string | undefined {
  const pessoa =
    typeof campos.type === "string" && campos.type.trim().toLowerCase() === "pessoa";
  if (!("data_nascimento" in campos)) {
    return exigirEmPessoa && pessoa
      ? "Pessoa deve incluir 'data_nascimento' (YYYY-MM-DD ou null)."
      : undefined;
  }
  if (campos.data_nascimento === null) return undefined;
  if (!dataIsoValida(campos.data_nascimento)) {
    return "'data_nascimento' deve ser uma data real no formato YYYY-MM-DD ou null quando desconhecida.";
  }

  const agora = new Date();
  const hoje = [
    String(agora.getFullYear()).padStart(4, "0"),
    String(agora.getMonth() + 1).padStart(2, "0"),
    String(agora.getDate()).padStart(2, "0"),
  ].join("-");
  return campos.data_nascimento > hoje
    ? "'data_nascimento' não pode estar no futuro."
    : undefined;
}
