export type DiffKind = "context" | "addition" | "deletion";

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  readonly proposedIndex: number | null;
  /** Posição da versão proposta correspondente a esta linha do diff. Para
   * remoções, indica onde a linha original deve voltar ao se rejeitar a
   * alteração. */
  readonly proposedInsertionIndex: number;
}

/** Diff LCS por linhas. Memórias são arquivos pequenos; a implementação local
 * evita dependência e produz a mesma ordem remoção/adição de um diff unificado. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    new Uint32Array(newLines.length + 1));

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex]![newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? (table[oldIndex + 1]![newIndex + 1] ?? 0) + 1
        : Math.max(table[oldIndex + 1]![newIndex] ?? 0, table[oldIndex]![newIndex + 1] ?? 0);
    }
  }

  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length
      && oldLines[oldIndex] === newLines[newIndex]) {
      result.push(makeLine("context", oldLines[oldIndex] ?? "", oldIndex, newIndex, newIndex));
      oldIndex++; newIndex++; continue;
    }
    if (oldIndex < oldLines.length
      && (newIndex >= newLines.length
        || (table[oldIndex + 1]![newIndex] ?? 0) >= (table[oldIndex]![newIndex + 1] ?? 0))) {
      result.push(makeLine("deletion", oldLines[oldIndex] ?? "", oldIndex, null, newIndex));
      oldIndex++; continue;
    }
    result.push(makeLine("addition", newLines[newIndex] ?? "", null, newIndex, newIndex));
    newIndex++;
  }
  return result;
}

/** Linhas vazias carregam somente formatação Markdown. Elas continuam no
 * documento, mas não viram uma falsa alteração editável na revisão humana. */
export function isContentDiffLine(line: DiffLine): boolean {
  return Boolean(line.text.trim());
}

export function replaceDocumentLine(document: string, index: number, value: string): string {
  const trailingNewline = document.endsWith("\n");
  const lines = splitLines(document);
  if (index < 0 || index >= lines.length) return document;
  lines[index] = value;
  return joinLines(lines, trailingNewline);
}

/** Rejeita somente a alteração representada por uma linha do diff.
 *
 * Em uma substituição simples (linha vermelha seguida da verde), qualquer uma
 * das duas ações restaura diretamente a versão original. Em adições puras a
 * linha proposta é removida; em remoções puras a linha original volta para a
 * posição que ocupava no documento. */
export function rejectDiffLine(
  document: string,
  diff: readonly DiffLine[],
  diffIndex: number,
): string {
  const selected = diff[diffIndex];
  if (!selected || selected.kind === "context") return document;

  const blockStart = findChangeBlockStart(diff, diffIndex);
  const blockEnd = findChangeBlockEnd(diff, diffIndex);
  const deletions = diff.slice(blockStart, blockEnd + 1)
    .map((line, offset) => ({ line, index: blockStart + offset }))
    .filter((entry) => entry.line.kind === "deletion");
  const additions = diff.slice(blockStart, blockEnd + 1)
    .map((line, offset) => ({ line, index: blockStart + offset }))
    .filter((entry) => entry.line.kind === "addition");
  const selectedGroup = selected.kind === "deletion" ? deletions : additions;
  const selectedPosition = selectedGroup.findIndex((entry) => entry.index === diffIndex);
  const paired = selected.kind === "deletion"
    ? additions[selectedPosition]?.line
    : deletions[selectedPosition]?.line;

  // Uma remoção e uma adição na mesma posição representam, na prática, uma
  // linha alterada. Rejeitá-la troca a proposta pela linha original em um só
  // gesto, sem deixar uma duplicata ou um buraco intermediário.
  if (paired) {
    const deletion = selected.kind === "deletion" ? selected : paired;
    const addition = selected.kind === "addition" ? selected : paired;
    if (addition.proposedIndex !== null) {
      return replaceDocumentLine(document, addition.proposedIndex, deletion.text);
    }
  }

  const trailingNewline = document.endsWith("\n");
  const lines = splitLines(document);
  if (selected.kind === "addition" && selected.proposedIndex !== null) {
    if (selected.proposedIndex < 0 || selected.proposedIndex >= lines.length) return document;
    lines.splice(selected.proposedIndex, 1);
  } else if (selected.kind === "deletion") {
    const insertionIndex = Math.min(Math.max(selected.proposedInsertionIndex, 0), lines.length);
    lines.splice(insertionIndex, 0, selected.text);
  }
  return joinLines(lines, trailingNewline);
}

function makeLine(
  kind: DiffKind,
  text: string,
  oldIndex: number | null,
  newIndex: number | null,
  proposedInsertionIndex: number,
): DiffLine {
  return {
    kind,
    text,
    oldNumber: oldIndex === null ? null : oldIndex + 1,
    newNumber: newIndex === null ? null : newIndex + 1,
    proposedIndex: newIndex,
    proposedInsertionIndex,
  };
}

function findChangeBlockStart(diff: readonly DiffLine[], index: number): number {
  let cursor = index;
  while (cursor > 0 && diff[cursor - 1]?.kind !== "context") cursor--;
  return cursor;
}

function findChangeBlockEnd(diff: readonly DiffLine[], index: number): number {
  let cursor = index;
  while (cursor + 1 < diff.length && diff[cursor + 1]?.kind !== "context") cursor++;
  return cursor;
}

function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  if (!lines.length) return "";
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function splitLines(value: string): string[] {
  if (!value) return [];
  const normalized = value.replace(/\r\n/g, "\n");
  return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
}
