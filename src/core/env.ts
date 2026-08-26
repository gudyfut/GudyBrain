import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "./project-root";

/**
 * Carrega variaveis de um arquivo .env no process.env (sem dependencias).
 * So define variaveis que ainda nao existem no ambiente.
 * Aceita o formato `CHAVE = valor`, com ou sem espacos e aspas.
 */
export function loadEnv(file = ".env"): void {
  const path = resolve(PROJECT_ROOT, file);
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
