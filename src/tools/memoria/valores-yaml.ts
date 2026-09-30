/** Subconjunto deliberado: escalares de uma linha e listas inline de strings. */
export function serializarValorMemoria(value: unknown): string {
  if (typeof value === "string") {
    if (/[\r\n\u0000-\u001f\u007f]/u.test(value)) throw new Error("Metadados não aceitam quebras de linha ou caracteres de controle.");
    // Mantém palavras simples legíveis; cita sintaxe YAML, números e palavras reservadas.
    return value && value === value.trim() && /^[\p{L}_][\p{L}\p{N}_ .\/-]*$/u.test(value)
      && !/^(?:[-?]|null$|true$|false$|yes$|no$|on$|off$|~$|[-+]?\d)/iu.test(value)
      ? value : JSON.stringify(value);
  }
  if (value === null) return "null";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return `[${value.map(serializarValorMemoria).join(", ")}]`;
  throw new Error("Metadado deve ser texto, número finito, null ou lista de textos.");
}

export function interpretarValorMemoria(value: string): unknown {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error("Lista inline não fechada.");
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const items: string[] = [];
    let current = "";
    let quote: string | null = null;
    let escape = false;
    for (const char of inner) {
      if (escape) { current += char; escape = false; continue; }
      if (char === "\\" && quote === '"') { current += char; escape = true; continue; }
      if (char === '"' || char === "'") {
        if (quote === char) quote = null;
        else if (quote === null) quote = char;
        current += char; continue;
      }
      if (char === "," && quote === null) { items.push(current.trim()); current = ""; continue; }
      current += char;
    }
    if (quote || escape) throw new Error("Lista com aspas não fechadas.");
    items.push(current.trim());
    if (items.some((item) => !item)) throw new Error("Lista contém item vazio.");
    return items.map(escalar);
  }
  return escalar(value);
}

function escalar(value: string): string {
  if (value.startsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Escalar de texto inválido.");
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error("Aspas não fechadas.");
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}
