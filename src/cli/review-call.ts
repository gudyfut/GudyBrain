import * as readline from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { resolveCallSession } from "../agents/analisador-call/transcript";
import { loadEnv } from "../core/env";
import { revisarMemoria } from "./memory-review";

loadEnv();

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Uso: npm run call:review -- <sessão>");
  console.log("Entrega analise-call.json ao curador e abre a revisão humana.");
  process.exit(0);
}
const session = args.find((arg) => !arg.startsWith("--"));
if (!session) {
  console.error("Uso: npm run call:review -- <sessão>");
  process.exit(2);
}
const apiKey = process.env.GLM_API_KEY?.trim();
if (!apiKey) {
  console.error("Erro: GLM_API_KEY não definida no .env da raiz.");
  process.exit(2);
}

try {
  const sessionDir = resolveCallSession(session);
  const analysisPath = join(sessionDir, "analise-call.json");
  if (!existsSync(analysisPath)) {
    throw new Error(`Análise não encontrada: ${analysisPath}. Execute call:analyze primeiro.`);
  }
  const callAnalysis = readFileSync(analysisPath, "utf8");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await revisarMemoria({ rl, callAnalysis, apiKey });
  } finally {
    rl.close();
  }
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
