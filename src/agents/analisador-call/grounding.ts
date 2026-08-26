import {
  buscarContextoMemoria,
  carregarCatalogoMemoria,
  type EntradaCatalogoMemoria,
} from "../../tools/memoria/catalogo";
import type { CallObservation, PossibleMemoryMatch } from "./types";

/** Acrescenta indícios recuperados somente depois de encerrada a extração.
 * Eles orientam o curador, mas nunca alteram a alegação nem sua prioridade. */
export function attachPossibleMemoryMatches(
  observations: readonly CallObservation[],
  catalog = carregarCatalogoMemoria(),
): CallObservation[] {
  return observations.map((observation) => ({
    ...observation,
    possible_memory_matches: matchesForObservation(observation, catalog),
  }));
}

function matchesForObservation(
  observation: CallObservation,
  catalog: readonly EntradaCatalogoMemoria[],
): PossibleMemoryMatch[] {
  const subjects = [
    observation.subject,
    ...(observation.target ? [observation.target] : []),
    ...observation.about,
    ...observation.claimants,
  ];
  const entityIds = [...new Set(subjects.flatMap((subject) => subject.memory_id ? [subject.memory_id] : []))];
  const paths = [...new Set(subjects.flatMap((subject) => subject.memory_path ? [subject.memory_path] : []))];
  const names = [...new Set(subjects.map((subject) => subject.name).filter(Boolean))];
  return buscarContextoMemoria({
    consulta: `${observation.subject.name} ${names.join(" ")} ${observation.statement}`,
    tipoMemoria: observation.memory_type,
    entidadeIds: entityIds,
    pathsSugeridos: paths,
    limite: 3,
  }, catalog).map((match) => ({
    path: match.path,
    memory_id: match.id,
    title: match.title,
    score: match.score,
    reasons: match.reasons,
  }));
}
