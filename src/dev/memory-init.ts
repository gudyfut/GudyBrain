import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../core/project-root";

/**
 * Cria o bundle `memory/` a partir de `memory-seed/` quando ele ainda não
 * existe. O seed é um conjunto fictício de demonstração; a memória real de
 * cada usuário fica apenas na máquina local, fora do controle de versão.
 */
const destino = resolve(PROJECT_ROOT, "memory");
const origem = resolve(PROJECT_ROOT, "memory-seed");

if (existsSync(resolve(destino, "index.md"))) {
  console.log("✓ Bundle de memória já existe em memory/; nada a fazer.");
  process.exit(0);
}

if (!existsSync(origem)) {
  console.error("✗ memory-seed/ não encontrado neste repositório.");
  process.exit(1);
}

mkdirSync(destino, { recursive: true });
cpSync(origem, destino, { recursive: true });
console.log("✓ Bundle de demonstração criado em memory/ (conteúdo fictício).");
console.log("  Este diretório é pessoal e fica fora do controle de versão (.gitignore).");
