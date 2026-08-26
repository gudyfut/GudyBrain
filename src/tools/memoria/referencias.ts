import { carregarCatalogoMemoria } from "./catalogo";
import { normalizar } from "./frontmatter";

const REFERENCE_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  grupo: { membros: ["pessoa"] },
  projeto: { participantes: ["pessoa", "grupo"] },
  evento: { participantes: ["pessoa", "grupo"], lugares: ["lugar"] },
};

/** Confere integridade referencial contra o bundle atual. IDs substituem nomes
 * justamente para que renomeações não quebrem a identificação. */
export function erroIntegridadeReferencias(
  campos: Record<string, unknown>,
): string | undefined {
  const type = normalizar(String(campos.type ?? ""));
  const rules = REFERENCE_FIELDS[type];
  if (!rules) return undefined;
  const byId = new Map(
    carregarCatalogoMemoria()
      .filter((entry) => entry.id)
      .map((entry) => [entry.id as string, entry]),
  );
  for (const [field, allowedTypes] of Object.entries(rules)) {
    const ids = campos[field];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const target = byId.get(id);
      if (!target) return `'${field}' referencia ID inexistente: ${id}.`;
      if (!allowedTypes.includes(normalizar(target.type))) {
        return `'${field}' referencia ${target.type}, mas aceita ${allowedTypes.join("/")}: ${id}.`;
      }
    }
  }
  return undefined;
}
