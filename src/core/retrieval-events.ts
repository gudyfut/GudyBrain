/** Eventos observáveis de navegação; nunca contêm raciocínio privado ou corpos de arquivos. */
export interface RetrievalNodeEvent {
  path: string;
  kind: "folder" | "file";
  title: string;
  probability?: number;
  accepted?: boolean;
  reason?: string;
  aliases?: string[];
  description?: string;
  chars?: number;
  source?: "jev" | "conversador" | "identity";
}
export type RetrievalEvent =
  | { phase: "gate" }
  | { phase: "index"; nodes: RetrievalNodeEvent[]; chars: number }
  | { phase: "decision"; searched: boolean; probability: number; threshold?: number; reason?: string }
  | { phase: "folder"; path: string }
  | { phase: "discovered"; parent: string; nodes: RetrievalNodeEvent[] }
  | { phase: "evaluated"; parent: string; nodes: RetrievalNodeEvent[] }
  | { phase: "selected"; path: string; chars?: number; source?: "jev" | "conversador" | "identity" }
  | { phase: "request"; paths: string[]; round: number }
  | { phase: "omitted"; path: string; reason: string }
  | { phase: "complete"; files: number; limited: boolean }
  | { phase: "answer" };
