import { normalizarEspacamentoCorpo } from "./preencher";

/** Mescla dois corpos Markdown por seção sem apagar conteúdo existente.
 * Usado somente ao corrigir uma proposta que tentou criar uma memória já
 * existente. A correção volta para a UI antes da escrita, para revisão. */
export function mesclarCorposMarkdown(atual: string, proposto: string): string {
  const atualSections = dividirSecoes(atual);
  const proposedSections = dividirSecoes(proposto);
  const byKey = new Map(atualSections.map((section) => [section.key, { ...section }]));
  const order = atualSections.map((section) => section.key);

  for (const proposed of proposedSections) {
    const existing = byKey.get(proposed.key);
    if (!existing) {
      byKey.set(proposed.key, proposed);
      order.push(proposed.key);
      continue;
    }
    existing.content = mesclarConteudo(existing.content, proposed.content);
  }

  return normalizarEspacamentoCorpo(order
    .map((key) => {
      const section = byKey.get(key);
      if (!section) return "";
      return [section.heading, section.content.trim()].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .trim());
}

/** Em uma criação convertida para atualização, campos nulos da proposta não
 * podem apagar valores já conhecidos. Listas são unidas; os demais valores
 * informados continuam propostos e visíveis para revisão. */
export function mesclarFrontmatterExistente(
  atual: Record<string, unknown>,
  proposto: Record<string, unknown>,
): Record<string, unknown> {
  // Começa pelo registro atual para que até campos de versões antigas do
  // schema, ausentes na proposta, continuem presentes para a revisão humana.
  const merged: Record<string, unknown> = { ...atual };
  for (const [key, proposedValue] of Object.entries(proposto)) {
    const currentValue = atual[key];
    if (valorAusente(proposedValue) && !valorAusente(currentValue)) {
      merged[key] = currentValue;
    } else if (Array.isArray(proposedValue) && Array.isArray(currentValue)) {
      merged[key] = [...new Set([...currentValue, ...proposedValue])];
    } else {
      merged[key] = proposedValue;
    }
  }
  return merged;
}

interface MarkdownSection {
  readonly key: string;
  readonly heading: string;
  content: string;
}

function dividirSecoes(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let heading = "";
  let key = "__preamble__";
  let lines: string[] = [];
  const flush = (): void => {
    const content = lines.join("\n").trim();
    if (heading || content) sections.push({ key, heading, content });
  };

  for (const line of markdown.trim().split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match?.[2]) {
      flush();
      heading = line.trim();
      key = normalizarChave(match[2]);
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function mesclarConteudo(atual: string, proposto: string): string {
  const existing = atual.trim();
  const proposed = proposto.trim();
  if (conteudoVazio(proposed)) return existing;
  if (conteudoVazio(existing)) return proposed;
  const normalizedExisting = normalizarTexto(existing);
  const normalizedProposed = normalizarTexto(proposed);
  if (normalizedExisting.includes(normalizedProposed)) return existing;
  if (normalizedProposed.includes(normalizedExisting)) return proposed;

  const existingLines = existing.split(/\r?\n/).filter((line) => line.trim());
  const proposedLines = proposed.split(/\r?\n/).filter((line) => line.trim());
  if ([...existingLines, ...proposedLines].every((line) => /^\s*[-*+]\s+/.test(line))) {
    const seen = new Set(existingLines.map(normalizarTexto));
    return [...existingLines, ...proposedLines.filter((line) => !seen.has(normalizarTexto(line)))].join("\n");
  }

  const blocks = existing.split(/\n\s*\n/);
  const seen = new Set(blocks.map(normalizarTexto));
  for (const block of proposed.split(/\n\s*\n/)) {
    if (!seen.has(normalizarTexto(block))) blocks.push(block);
  }
  return blocks.join("\n\n");
}

function conteudoVazio(value: string): boolean {
  return !value || /^(?:null|não informado|nao informado|não informado\.|nao informado\.|—|-)$/i.test(value);
}

function valorAusente(value: unknown): boolean {
  return value === null
    || value === undefined
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function normalizarChave(value: string): string {
  return normalizarTexto(value).replace(/[^a-z0-9]+/g, "-");
}

function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
