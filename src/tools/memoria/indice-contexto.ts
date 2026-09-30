import type { MemoryBrowser, MemoryNode } from "./navegador";

export interface MemoryIndex { nodes: MemoryNode[]; identities: Map<string, string[]>; chars: number }

/** Índice efêmero, reconstruído a cada turno. Nunca grava dados pessoais no repositório. */
export function buildMemoryIndex(browser: Pick<MemoryBrowser, "list">): MemoryIndex {
  const nodes: MemoryNode[] = [];
  const visited = new Set<string>();
  const walk = (folder: string) => {
    if (visited.has(folder)) return;
    visited.add(folder);
    if (visited.size > 200 || folder.split("/").length > 15) throw new Error("Índice de memória excede o limite de pastas/profundidade.");
    for (const node of browser.list(folder)) {
      if (nodes.length >= 2000) throw new Error("Índice excede 2000 nós; compacte a memória antes de continuar.");
      nodes.push(node);
      if (node.kind === "folder") walk(node.path);
    }
  };
  walk("");
  const identities = identityEntries(nodes);
  // O catálogo completo é local e também alimenta o atlas; nenhum prompt o recebe.
  return { nodes, identities, chars: JSON.stringify(nodes).length };
}

export function mentionedMemories(input: string, source: readonly MemoryNode[] | MemoryIndex): string[] {
  const haystack = normalize(input);
  const identities = Array.isArray(source) ? identityEntries(source) : (source as MemoryIndex).identities;
  const paths = new Set<string>();
  for (const [name, matches] of identities) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(haystack))
      for (const path of matches) paths.add(path);
  }
  return [...paths];
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const identityEntries = (nodes: readonly MemoryNode[]): Map<string, string[]> => {
  const identities = new Map<string, string[]>();
  for (const node of nodes) if (node.kind === "file") for (const value of [node.title, ...(node.aliases ?? [])]) {
    const name = normalize(value.trim());
    if (name.length < 3) continue;
    const paths = identities.get(name) ?? [];
    if (!paths.includes(node.path)) paths.push(node.path);
    identities.set(name, paths);
  }
  return identities;
};
const words = (value: string) => normalize(value).match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) =>
  !new Set(["que", "com", "para", "uma", "como", "sobre", "este", "essa", "isso", "voce", "meu", "minha", "seus", "suas", "qual", "quais", "onde", "quando", "pode", "sabe", "fale"]).has(word)) ?? [];
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Short deterministic candidate list; broadening is explicit via folder or query. */
export function locateMemory(index: MemoryIndex, query: string, options: {
  scopes?: readonly string[]; preferred?: readonly string[]; exclude?: ReadonlySet<string>; limit?: number;
} = {}): { files: MemoryNode[]; folders: MemoryNode[] } {
  const lookup = new Map(index.nodes.map((node) => [node.path, node]));
  const scopes = options.scopes ?? [];
  const preferred = new Set(options.preferred ?? []);
  const tokens = [...new Set(words(query))];
  const direct = new Set(mentionedMemories(query, index));
  const inside = (path: string) => !scopes.length || scopes.some((scope) => path.startsWith(`${scope}/`));
  const score = (node: MemoryNode) => {
    const title = normalize([node.title, ...(node.aliases ?? [])].join(" "));
    const context = normalize(`${node.path} ${node.description} ${lookup.get(parentOf(node.path))?.description ?? ""}`);
    return (preferred.has(node.path) ? 1000 : 0) + (direct.has(node.path) ? 500 : 0)
      + tokens.reduce((sum, token) => sum + (title.includes(token) ? 12 : 0) + (context.includes(token) ? 3 : 0), 0);
  };
  const rank = (a: MemoryNode, b: MemoryNode) => score(b) - score(a) || a.path.localeCompare(b.path);
  const files = index.nodes.filter((node) => node.kind === "file" && inside(node.path) && !options.exclude?.has(node.path)).sort(rank).slice(0, options.limit ?? 24);
  const folders = index.nodes.filter((node) => node.kind === "folder" && (!scopes.length ? !parentOf(node.path) : scopes.includes(parentOf(node.path)))).sort(rank).slice(0, 24);
  return { files, folders };
}
