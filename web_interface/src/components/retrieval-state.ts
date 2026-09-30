import type { RetrievalEvent, RetrievalNodeEvent } from "@gudybrain/core/retrieval-events";

export interface TraceNode extends RetrievalNodeEvent { parent: string; selected?: boolean; visited?: boolean; omitted?: string }
export interface RetrievalTrace {
  phase: "gate" | "search" | "answer" | "done" | "error" | "cancelled";
  nodes: Record<string, TraceNode>;
  visits: string[];
  active: string;
  searched?: boolean;
  probability?: number;
  limited: boolean;
  gateSearched?: boolean;
  gateReason?: string;
  threshold?: number;
  indexChars?: number;
  requests?: Array<{ paths: string[]; round: number }>;
}
export function initialTrace(): RetrievalTrace { return { phase: "gate", nodes: {}, visits: [], active: "", limited: false }; }
export function reduceTrace(state: RetrievalTrace, event: RetrievalEvent): RetrievalTrace {
  if (["done", "error", "cancelled"].includes(state.phase)) return state;
  switch (event.phase) {
    case "gate": return initialTrace();
    case "decision": return { ...state, searched: event.searched, gateSearched: event.searched, probability: event.probability, threshold: event.threshold ?? .5, gateReason: event.reason, phase: event.searched ? "search" : "answer" };
    case "index": {
      const nodes: Record<string, TraceNode> = { ...state.nodes, "": { path: "", parent: "", title: "Memória", kind: "folder" } };
      for (const node of event.nodes) nodes[node.path] = { ...node, parent: node.path.split("/").slice(0, -1).join("/") };
      return { ...state, indexChars: event.chars, nodes };
    }
    case "folder": return { ...state, active: event.path, visits: state.visits.includes(event.path) ? state.visits : [...state.visits, event.path],
      nodes: { ...state.nodes, [event.path]: { ...state.nodes[event.path], path: event.path, parent: state.nodes[event.path]?.parent ?? "", kind: "folder", title: state.nodes[event.path]?.title ?? "Memória", visited: true } } };
    case "discovered":
    case "evaluated": {
      const nodes = { ...state.nodes };
      for (const node of event.nodes) nodes[node.path] = { ...nodes[node.path], ...node, parent: event.parent };
      return { ...state, nodes };
    }
    case "selected": return state.nodes[event.path] ? { ...state, nodes: { ...state.nodes, [event.path]: { ...state.nodes[event.path]!, selected: true, chars: event.chars, source: event.source, omitted: undefined } } } : state;
    case "omitted": return { ...state, limited: true, nodes: { ...state.nodes, [event.path]: { ...state.nodes[event.path]!, omitted: event.reason } } };
    case "request": return { ...state, phase: "search", searched: true, requests: [...(state.requests ?? []), { paths: event.paths, round: event.round }] };
    case "complete": return { ...state, limited: event.limited };
    case "answer": return { ...state, phase: "answer" };
  }
}

/** Keep the structure readable; reveal files on demand and always show final context. */
export function visibleGraphTrace(trace: RetrievalTrace, expanded: ReadonlySet<string>): RetrievalTrace {
  const nodes = Object.fromEntries(Object.entries(trace.nodes).filter(([path, node]) =>
    !path || node.kind === "folder" || node.selected || expanded.has(node.parent)));
  return { ...trace, nodes };
}

/** Árvore estável por caminho; pode ser recortada sem esconder a contagem real. */
export function graphNodes(trace: RetrievalTrace, limit = 100): Array<TraceNode & { x: number; y: number }> {
  const all = Object.values(trace.nodes);
  const keep = new Set<string>(["", trace.active]);
  for (const node of all) if (node.selected) keep.add(node.path);
  for (const path of [...keep]) {
    let parent = trace.nodes[path]?.parent;
    while (parent) { keep.add(parent); parent = trace.nodes[parent]?.parent; }
  }
  for (const node of all) { if (keep.size >= limit) break; keep.add(node.path); }
  const selected = all.filter((node) => keep.has(node.path));
  const positions: Array<TraceNode & { x: number; y: number }> = [];
  const byParent = new Map<string, TraceNode[]>();
  for (const node of selected) if (node.path !== node.parent) {
    const siblings = byParent.get(node.parent) ?? [];
    siblings.push(node); byParent.set(node.parent, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.path.localeCompare(b.path));
  const children = (path: string) => byParent.get(path) ?? [];
  const weights = new Map<string, number>();
  const weight = (path: string): number => {
    const result = Math.max(1, children(path).reduce((sum, child) => sum + weight(child.path), 0));
    weights.set(path, result); return result;
  };
  weight("");
  const counts = new Map<number, number>();
  for (const node of selected) { const depth = node.path ? node.path.split("/").length : 0; counts.set(depth, (counts.get(depth) ?? 0) + 1); }
  const angles = new Map<number, number[]>();
  const collectAngles = (path: string, depth: number, start: number, end: number) => {
    const group = angles.get(depth) ?? [];
    group.push((start + end) / 2);
    angles.set(depth, group);
    let cursor = start;
    for (const child of children(path)) {
      const span = (end - start) * weights.get(child.path)! / weights.get(path)!;
      collectAngles(child.path, depth + 1, cursor, cursor + span); cursor += span;
    }
  };
  collectAngles("", 0, 0, Math.PI * 2);
  const radii = [0];
  for (let depth = 1; depth <= Math.max(0, ...counts.keys()); depth++) {
    const sorted = (angles.get(depth) ?? []).sort((a, b) => a - b);
    const gaps = sorted.map((angle, index) => (sorted[(index + 1) % sorted.length]! + (index === sorted.length - 1 ? Math.PI * 2 : 0)) - angle);
    const smallestGap = sorted.length > 1 ? Math.min(...gaps) : Math.PI * 2;
    radii[depth] = Math.max(radii[depth - 1]! + 245, 205 / smallestGap);
  }
  const center = Math.max(320, radii.at(-1)! + 105);
  const visit = (path: string, depth: number, start: number, end: number) => {
    const node = trace.nodes[path];
    if (!node) return;
    const angle = (start + end) / 2 - Math.PI / 2;
    positions.push({ ...node, x: center + Math.cos(angle) * radii[depth]!, y: center + Math.sin(angle) * radii[depth]! });
    let cursor = start;
    for (const child of children(path)) {
      const span = (end - start) * weights.get(child.path)! / weights.get(path)!;
      visit(child.path, depth + 1, cursor, cursor + span); cursor += span;
    }
  };
  visit("", 0, 0, Math.PI * 2);
  return positions;
}
