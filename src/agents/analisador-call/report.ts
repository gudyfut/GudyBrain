import { renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CallAnalysis, CallMemorySignal, CallObservation, MemoryType } from "./types";
import { MEMORY_TYPES } from "./types";
import { formatOffset } from "./transcript";

export function writeCallAnalysis(
  analysis: CallAnalysis,
  sessionDir: string,
): { jsonPath: string; markdownPath: string } {
  const jsonPath = join(sessionDir, "analise-call.json");
  const markdownPath = join(sessionDir, "analise-call.md");
  writeAtomic(jsonPath, `${JSON.stringify(analysis, null, 2)}\n`);
  writeAtomic(markdownPath, renderCallAnalysisMarkdown(analysis));
  return { jsonPath, markdownPath };
}

export function renderCallAnalysisMarkdown(analysis: CallAnalysis): string {
  const lines: string[] = [
    "# Análise da call",
    "",
    `- **Sessão:** ${analysis.session_id}`,
    `- **Início:** ${analysis.started_at ?? "desconhecido"}`,
    `- **Fim:** ${analysis.ended_at ?? "desconhecido"}`,
    `- **Modelo:** ${analysis.analyzer.model}`,
    `- **Observações:** ${analysis.observations.length}`,
    "",
    "## Participantes",
    "",
  ];

  if (analysis.participants.length) {
    for (const participant of analysis.participants) {
      const memory = participant.person_id ? ` — \`${participant.person_id}\`` : "";
      lines.push(`- ${participant.display_name}${memory}`);
    }
  } else {
    lines.push("Nenhum participante identificado.");
  }

  const context = analysis.conversation_context;
  lines.push(
    "",
    "## Contexto geral da conversa",
    "",
    context.summary || analysis.summary || "Sem resumo.",
    "",
    `- **Atividade principal:** ${context.primary_activity ?? "não determinada"}`,
    `- **Tom predominante:** ${context.tone}`,
    `- **Dinâmica:** ${context.interaction_dynamics}`,
    `- **Assuntos dominantes:** ${context.dominant_topics.join(", ") || "não determinados"}`,
    "",
    "## Recomendação ao curador",
    "",
    `- **Justificativa:** ${context.curator_recommendation.rationale}`,
  );
  if (context.curator_recommendation.focus.length) {
    lines.push("- **Priorizar:**");
    lines.push(...context.curator_recommendation.focus.map((item) => `  - ${item}`));
  }
  if (context.curator_recommendation.avoid_overinterpreting.length) {
    lines.push("- **Evitar superinterpretar:**");
    lines.push(
      ...context.curator_recommendation.avoid_overinterpreting.map((item) => `  - ${item}`),
    );
  }
  lines.push("", "## Blocos por potencial de memória", "");
  const byId = new Map(analysis.observations.map((observation) => [observation.id, observation]));
  for (const block of analysis.memory_blocks) {
    const observations = block.observation_ids.flatMap((id) => {
      const observation = byId.get(id);
      return observation ? [observation] : [];
    });
    lines.push(`### ${memoryBlockLabel(block.signal)}`, "", memoryBlockDescription(block.signal), "");
    if (!observations.length) {
      lines.push("Nenhuma observação neste bloco.");
      continue;
    }
    for (const type of MEMORY_TYPES) {
      const typed = observations.filter((observation) => observation.memory_type === type);
      if (!typed.length) continue;
      lines.push(`#### ${headingForType(type)}`, "");
      for (const observation of typed) lines.push(...renderObservation(observation), "");
      if (lines.at(-1) === "") lines.pop();
      lines.push("");
    }
    if (lines.at(-1) === "") lines.pop();
  }

  lines.push("", "## Ambiguidades", "");
  if (analysis.ambiguities.length) {
    lines.push(...analysis.ambiguities.map((ambiguity) => `- ${ambiguity}`));
  } else {
    lines.push("Nenhuma ambiguidade relevante registrada.");
  }
  return `${lines.join("\n").trim()}\n`;
}

function memoryBlockLabel(signal: CallMemorySignal): string {
  return signal === "alto" ? "Alto potencial" : signal === "medio" ? "Médio potencial" : "Baixo potencial";
}

function memoryBlockDescription(signal: CallMemorySignal): string {
  if (signal === "alto") return "Decisões, projetos, compromissos, mudanças e fatos duráveis que exigem revisão cuidadosa.";
  if (signal === "medio") return "Informações possivelmente úteis, ainda contextuais, incompletas ou hipotéticas.";
  return "Conteúdo predominantemente efêmero, recreativo ou circunstancial; mantenha apenas para auditoria.";
}

function renderObservation(observation: CallObservation): string[] {
  const target = observation.target ? ` → ${observation.target.name}` : "";
  const subjectMemory = observation.subject.memory_id
    ? ` (\`${observation.subject.memory_id}\`)`
    : "";
  const lines = [
    `##### ${observation.subject.name}${target}`,
    "",
    `- **Seção:** ${observation.section}`,
    `- **Informação:** ${observation.statement}`,
    `- **Natureza:** ${observation.basis === "explicita" ? "explícita" : "síntese interpretativa"}`,
    `- **Tipo de evidência:** ${observation.epistemic_kind.replaceAll("_", " ")}`,
    `- **Confiança:** ${observation.confidence}`,
    `- **Potencial de memória:** ${observation.memory_signal}`,
  ];
  if (subjectMemory) lines[0] += subjectMemory;
  if (observation.about.length) {
    lines.push(`- **Sobre:** ${observation.about.map((item) => item.name).join(", ")}`);
  }
  if (observation.claimants.length) {
    lines.push(`- **Atribuída a:** ${observation.claimants.map((item) => item.name).join(", ")}`);
  }
  if (observation.temporal_context) {
    lines.push(`- **Contexto temporal:** ${observation.temporal_context}`);
  }
  if (observation.notes) lines.push(`- **Nota:** ${observation.notes}`);
  if (observation.possible_memory_matches.length) {
    lines.push("- **Possíveis correspondências na memória (a verificar):**");
    for (const match of observation.possible_memory_matches) {
      lines.push(`  - \`${match.path}\` — ${match.title} (score ${match.score}: ${match.reasons.join(", ")})`);
    }
  }
  lines.push("- **Evidências:**");
  for (const evidence of observation.evidence) {
    lines.push(
      `  - \`${formatOffset(evidence.start)}–${formatOffset(evidence.end)}\` `
      + `${evidence.speaker_name}: “${compactEvidence(evidence.text)}” `
      + `(\`${evidence.utterance_id}\`)`,
    );
  }
  return lines;
}

function headingForType(type: MemoryType): string {
  return {
    Pessoa: "Pessoas e relações",
    Grupo: "Grupos",
    Lugar: "Lugares",
    Evento: "Possíveis eventos",
    Projeto: "Projetos",
    Conhecimento: "Conhecimentos do Criador",
  }[type];
}

function compactEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function writeAtomic(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}
