import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Localiza a raiz estável do GudyBrain mesmo quando um subprojeto (como a
 * interface web) é o diretório de execução atual. */
export function findProjectRoot(start = process.cwd()): string {
  const configured = process.env.GUDYBRAIN_ROOT?.trim();
  if (configured) {
    const root = resolve(configured);
    if (isProjectRoot(root)) return root;
    throw new Error(`GUDYBRAIN_ROOT não aponta para a raiz do GudyBrain: ${root}`);
  }

  let current = resolve(start);
  while (true) {
    if (isProjectRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Não foi possível localizar a raiz do GudyBrain a partir de ${start}.`);
}

export const PROJECT_ROOT = findProjectRoot();

export function resolveProjectPath(...segments: string[]): string {
  return resolve(PROJECT_ROOT, ...segments);
}

function isProjectRoot(directory: string): boolean {
  return existsSync(resolve(directory, "package.json"))
    && existsSync(resolve(directory, "src", "agents", "registry.ts"))
    && existsSync(resolve(directory, "discordbot", "pyproject.toml"));
}
