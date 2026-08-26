"use client";

import { useEffect, useMemo, useState } from "react";
import { Code2, ListTree, PencilLine, Undo2 } from "lucide-react";
import { isContentDiffLine, lineDiff, rejectDiffLine, replaceDocumentLine } from "./line-diff";

export function EditableDiff({
  current,
  proposed,
  onChange,
  disabled = false,
}: {
  current: string;
  proposed: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [fullEditor, setFullEditor] = useState(false);
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);
  const lines = useMemo(() => lineDiff(current, proposed), [current, proposed]);
  const additions = lines.filter((line) => line.kind === "addition" && isContentDiffLine(line)).length;
  const deletions = lines.filter((line) => line.kind === "deletion" && isContentDiffLine(line)).length;

  useEffect(() => setEditing(null), [current]);

  function commit(): void {
    if (!editing) return;
    onChange(replaceDocumentLine(proposed, editing.index, editing.value));
    setEditing(null);
  }

  function rejectLine(index: number): void {
    if (editing) return;
    onChange(rejectDiffLine(proposed, lines, index));
  }

  return <div className="editable-diff">
    <div className="diff-toolbar">
      <div><strong>Alterações no arquivo</strong><span className="diff-stat additions">+{additions}</span><span className="diff-stat deletions">−{deletions}</span></div>
      <button type="button" className="button ghost compact" onClick={() => setFullEditor((value) => !value)} disabled={disabled || editing !== null}>
        {fullEditor ? <ListTree size={14} /> : <Code2 size={14} />}
        {fullEditor ? "Ver comparação" : "Editar arquivo completo"}
      </button>
    </div>
    {fullEditor ? <textarea
      className="field raw-proposal-editor"
      value={proposed}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      spellCheck={false}
      aria-label="Conteúdo integral proposto"
    /> : <>
      <div className="diff-edit-hint"><PencilLine size={13} /> Clique no texto para editar. Use “Rejeitar linha” para descartar só aquela alteração.</div>
      <div className="diff-table" role="table" aria-label="Comparação da memória atual com a proposta">
        {lines.map((line, index) => {
          if (!isContentDiffLine(line)) return null;
          const editable = !disabled && line.proposedIndex !== null;
          const isEditing = editing?.index === line.proposedIndex;
          return <div
            className={`diff-row ${line.kind}${editable ? " editable" : ""}`}
            key={`${line.kind}-${line.oldNumber ?? "x"}-${line.newNumber ?? "x"}-${index}`}
            role="row"
            tabIndex={editable ? 0 : undefined}
            onClick={() => editable && line.proposedIndex !== null && setEditing({ index: line.proposedIndex, value: line.text })}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (editable && line.proposedIndex !== null && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                setEditing({ index: line.proposedIndex, value: line.text });
              }
            }}
          >
            <span className="diff-line-number">{line.oldNumber ?? ""}</span>
            <span className="diff-line-number">{line.newNumber ?? ""}</span>
            <span className="diff-marker">{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}</span>
            {isEditing ? <input
              autoFocus
              className="diff-line-input"
              value={editing.value}
              onChange={(event) => setEditing({ index: editing.index, value: event.target.value })}
              onClick={(event) => event.stopPropagation()}
              onBlur={commit}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") { event.preventDefault(); commit(); }
                if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
              }}
              aria-label={`Editar linha ${line.newNumber ?? ""}`}
            /> : <code className="diff-line-content">{line.text || " "}</code>}
            {line.kind === "context" ? <span className="diff-line-action-spacer" /> : <button
              type="button"
              className="diff-line-reject"
              disabled={disabled || editing !== null}
              onClick={(event) => { event.stopPropagation(); rejectLine(index); }}
              onKeyDown={(event) => event.stopPropagation()}
              title={line.kind === "addition" ? "Remover esta linha da proposta" : "Restaurar a linha original"}
              aria-label={`${line.kind === "addition" ? "Remover" : "Restaurar"} linha ${line.newNumber ?? line.oldNumber ?? ""}`}
            ><Undo2 size={12} /><span>Rejeitar linha</span></button>}
          </div>;
        })}
      </div>
    </>}
  </div>;
}
