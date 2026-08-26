import { validarAlvosCandidato } from "@gudybrain/tools/memoria/candidato";
import {
  mesclarCorposMarkdown,
  mesclarFrontmatterExistente,
} from "@gudybrain/tools/memoria/mesclar-corpo";
import {
  interpretarDocumentoEditavel,
  montarPreviaMemoria,
} from "@gudybrain/tools/memoria/documento-editavel";
import { isContentDiffLine, lineDiff, rejectDiffLine } from "@web/components/line-diff";
import {
  actionableCandidates,
  candidateStatusCounts,
  candidateStatusLabel,
  nextActionableId,
} from "@web/components/review-state";
import {
  recordApplicationResult,
  type ApplicationCandidateState,
} from "@web/server/candidate-application";
import type { Candidato } from "@gudybrain/tools/memoria/candidato";

const existing = new Set([
  "social/pessoas/pessoa-existente.md",
  "lugares/destino-ocupado.md",
]);
const exists = (path: string): boolean => existing.has(path);

assertIncludes(
  validarAlvosCandidato("criar", "social/pessoas/pessoa-existente", undefined, exists),
  "já existe",
  "criação sobre arquivo existente precisa ser recusada",
);
assertIncludes(
  validarAlvosCandidato("atualizar", "lugares/inexistente", undefined, exists),
  "não existe",
  "atualização sem origem precisa ser recusada",
);
assertIncludes(
  validarAlvosCandidato(
    "atualizar",
    "lugares/destino-ocupado",
    "social/pessoas/pessoa-existente",
    exists,
  ),
  "destino já existe",
  "renomeação sobre arquivo existente precisa ser recusada",
);
if (validarAlvosCandidato("criar", "lugares/novo", undefined, exists) !== null) {
  throw new Error("criação em caminho livre deveria ser aceita");
}

const merged = mesclarCorposMarkdown(
  "## Informações gerais\n\n- Profissão: Desenvolvedor\n\n## Relações\n\n- [Bianca](bianca.md): amiga",
  "## Informações gerais\n\n- Cidade: São Carlos\n\n## Princípios e Valores\n\nLealdade.",
);
for (const expected of ["Profissão: Desenvolvedor", "Cidade: São Carlos", "Bianca", "Lealdade."]) {
  if (!merged.includes(expected)) throw new Error(`mescla perdeu conteúdo: ${expected}`);
}
if (/^## .+\n\n(?!## )/mu.test(merged)) {
  throw new Error("mescla introduziu linha vazia decorativa após título de seção");
}

const mergedFrontmatter = mesclarFrontmatterExistente(
  {
    data_nascimento: "2000-01-02",
    tags: ["amigo"],
    proximidade: "4",
    campo_legado: "preservar",
  },
  { data_nascimento: null, tags: ["escola"], proximidade: null, afinidade: 3 },
);
if (mergedFrontmatter.data_nascimento !== "2000-01-02" || mergedFrontmatter.proximidade !== "4") {
  throw new Error("mescla apagou campos existentes com valores nulos");
}
if (JSON.stringify(mergedFrontmatter.tags) !== JSON.stringify(["amigo", "escola"])) {
  throw new Error("mescla não preservou listas existentes");
}
if (mergedFrontmatter.campo_legado !== "preservar") {
  throw new Error("mescla removeu um campo existente ausente da proposta");
}

const currentDocument = `---
type: pessoa
id: mem_0123456789abcdef0123456789abcdef
title: Ana
apelido: null
data_nascimento: null
description: Amiga
categoria: Amigo
vinculo: Escola
proximidade: 3
afinidade: 4
tags: [amiga]
status: draft
generated: { by: teste, at: 2026-08-09T10:00 }
---

## Informações gerais

Estuda música.
`;
const proposedDocument = montarPreviaMemoria(
  currentDocument,
  { title: "Ana Souza", tags: ["amiga", "música"] },
  "## Informações gerais\n\nEstuda música e trabalha com design.",
);
const parsedDocument = interpretarDocumentoEditavel(proposedDocument, currentDocument);
if (parsedDocument.campos.title !== "Ana Souza" || parsedDocument.campos.proximidade !== 3) {
  throw new Error("editor integral perdeu valores ou tipos do frontmatter");
}
const diff = lineDiff(currentDocument, proposedDocument);
if (!diff.some((line) => line.kind === "addition") || !diff.some((line) => line.kind === "deletion")) {
  throw new Error("comparação não marcou linhas adicionadas e removidas");
}
const spacingOnlyDiff = lineDiff("primeira\núltima\n", "primeira\n\núltima\n");
if (spacingOnlyDiff.some((line) => line.kind !== "context" && isContentDiffLine(line))) {
  throw new Error("comparação exibiu espaçamento decorativo como alteração revisável");
}

const changedBefore = "primeira\nvalor original\núltima\n";
const changedAfter = "primeira\nvalor proposto\núltima\n";
const changedDiff = lineDiff(changedBefore, changedAfter);
const changedAddition = changedDiff.findIndex((line) => line.kind === "addition");
const changedDeletion = changedDiff.findIndex((line) => line.kind === "deletion");
if (rejectDiffLine(changedAfter, changedDiff, changedAddition) !== changedBefore) {
  throw new Error("rejeitar a linha verde de uma substituição não restaurou a original");
}
if (rejectDiffLine(changedAfter, changedDiff, changedDeletion) !== changedBefore) {
  throw new Error("rejeitar a linha vermelha de uma substituição não restaurou a original");
}
const additionBefore = "primeira\núltima\n";
const additionAfter = "primeira\nextra\núltima\n";
const additionDiff = lineDiff(additionBefore, additionAfter);
if (rejectDiffLine(additionAfter, additionDiff, additionDiff.findIndex((line) => line.kind === "addition")) !== additionBefore) {
  throw new Error("rejeitar uma adição pura não removeu somente a linha escolhida");
}
const deletionBefore = "primeira\nrestaurar\núltima\n";
const deletionAfter = "primeira\núltima\n";
const deletionDiff = lineDiff(deletionBefore, deletionAfter);
if (rejectDiffLine(deletionAfter, deletionDiff, deletionDiff.findIndex((line) => line.kind === "deletion")) !== deletionBefore) {
  throw new Error("rejeitar uma remoção pura não restaurou a linha escolhida");
}
assertThrows(
  () => interpretarDocumentoEditavel(proposedDocument.replace("status: draft", "status: ativo"), currentDocument),
  "gerenciado pelo sistema",
  "editor permitiu alterar campo gerenciado",
);

const afterApproval = [
  { id: "aprovada", decision: "aprovada" as const },
  { id: "proxima", decision: "pendente" as const },
];
if (actionableCandidates(afterApproval).some((item) => item.id === "aprovada")) {
  throw new Error("proposta aprovada continuou na fila acionável");
}
if (nextActionableId(afterApproval, "aprovada") !== "proxima") {
  throw new Error("interface não avançou para a próxima proposta");
}
const statusCounts = candidateStatusCounts([
  ...afterApproval,
  { id: "rejeitada", decision: "rejeitada" as const },
  { id: "erro", decision: "erro" as const },
]);
if (statusCounts.aprovada !== 1 || statusCounts.rejeitada !== 1 || statusCounts.erro !== 1) {
  throw new Error("cards não preservaram todos os estados da revisão");
}
if (candidateStatusLabel("erro") !== "Erro ao aplicar") {
  throw new Error("erro técnico não possui rótulo visual explícito");
}

const candidateToApply: Candidato & ApplicationCandidateState = {
  acao: "atualizar",
  path: "social/pessoas/ana.md",
  frontmatter: { title: "Ana" },
  corpo: "Antes",
  motivo: "Teste",
  naturezaProposta: "explicita",
  evidencias: [],
  observationIds: [],
  noveltyAssessments: [],
  consultedPaths: [],
  decision: "pendente",
  result: null,
};
recordApplicationResult(candidateToApply, {
  ...candidateToApply,
  corpo: "Depois",
}, "Atualizado: social/pessoas/ana.md");
if (candidateToApply.decision !== "aprovada" || candidateToApply.result?.startsWith("Atualizado") !== true) {
  throw new Error("aplicação bem-sucedida não permaneceu marcada como aprovada");
}
if (candidateToApply.corpo !== "Depois") {
  throw new Error("aplicação aprovada perdeu a edição humana");
}

console.log("✓ Curadoria web: conflitos são bloqueados e correções preservam o corpo existente.");

function assertIncludes(value: string | null, expected: string, message: string): void {
  if (!value?.includes(expected)) throw new Error(message);
}

function assertThrows(action: () => void, expected: string, message: string): void {
  try { action(); } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
  }
  throw new Error(message);
}
