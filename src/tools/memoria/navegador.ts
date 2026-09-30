import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export interface MemoryNode {
  path: string;
  kind: "folder" | "file";
  title: string;
  description: string;
  aliases?: string[];
  type?: string;
}

/** Leitura progressiva: somente filhos imediatos e metadados, sem catálogo global. */
export class MemoryBrowser {
  constructor(private readonly root: string) {}

  private safePath(path: string): string {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error("Caminho de memória inválido.");
    const root = resolve(this.root);
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) throw new Error("Caminho fora da memória.");
    // Também rejeita links/junctions que redirecionem componentes intermediários.
    let current = root;
    for (const part of relative(root, full).split(sep).filter(Boolean)) {
      current = join(current, part);
      if (!existsSync(current)) break;
      if (lstatSync(current).isSymbolicLink()) throw new Error("Links não são permitidos na busca de memória.");
    }
    if (existsSync(full)) {
      const canonicalRoot = realpathSync(root);
      const canonical = realpathSync(full);
      if (canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + sep)) throw new Error("Caminho fora da memória.");
    }
    return full;
  }

  list(folder: string): MemoryNode[] {
    if (!existsSync(this.root)) return [];
    const directory = this.safePath(folder);
    if (!existsSync(directory)) return [];
    const nodes: MemoryNode[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "index.md" || entry.isSymbolicLink()) continue;
      const kind = entry.isDirectory() ? "folder" : entry.isFile() && entry.name.endsWith(".md") ? "file" : null;
      if (!kind) continue;
      const path = [folder, entry.name].filter(Boolean).join("/");
      const metadataPath = kind === "folder" ? `${path}/index.md` : path;
      let title = entry.name.replace(/\.md$/, "");
      let aliases: string[] = [];
      let type: string | undefined;
      let description = "Sem descrição; o nome e o caminho são as pistas disponíveis.";
      if (existsSync(resolve(this.root, metadataPath))) {
        const file = this.safePath(metadataPath);
        if (lstatSync(file).size > 512_000) throw new Error("Arquivo de memória excede o limite de leitura de 512 KB.");
        const { campos, corpo } = parseFrontmatter(readFileSync(file, "utf8"));
        if (typeof campos.title === "string") title = campos.title;
        aliases = Array.isArray(campos.apelido) ? campos.apelido : typeof campos.apelido === "string" ? [campos.apelido] : [];
        type = typeof campos.type === "string" ? campos.type : undefined;
        if (typeof campos.description === "string") description = campos.description;
        else if (kind === "folder") description = corpo.replace(/```[\s\S]*?```/g, "").split(/\r?\n/)
          .filter((line) => line.trim() && !line.startsWith("#")).slice(0, 3).join(" ") || description;
      }
      nodes.push({ path, kind, title: title.slice(0, 160), description: description.slice(0, 300), aliases, type });
    }
    return nodes;
  }

  read(path: string): string {
    const full = this.safePath(path);
    const stat = lstatSync(full);
    if (!path.endsWith(".md") || !stat.isFile() || stat.size > 512_000) throw new Error("Arquivo de memória inválido ou maior que 512 KB.");
    return readFileSync(full, "utf8");
  }
}
