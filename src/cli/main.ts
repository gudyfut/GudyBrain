import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadEnv } from "../core/env";
import type { AgentEvent } from "../core/agent";
import { criarConversante } from "../agents/conversante/index";
import { revisarMemoria } from "./memory-review";
import {
  cabecalho,
  cor,
  criarIndicador,
  promptUsuario,
  tema,
  titulo,
} from "./ui";

loadEnv();

const apiKey = process.env.GLM_API_KEY ?? "";

if (!apiKey) {
  console.error("Erro: GLM_API_KEY nao definida. Verifique o arquivo .env.");
  process.exit(1);
}

const atividadeConversa = criarIndicador("conversa");
function onStep(event: AgentEvent): void {
  atividadeConversa.evento(event);
  if (event.type === "max_steps") {
    console.log(cor("O agente atingiu o limite de passos.", tema.yellow));
  }
}

const conversante = criarConversante({ apiKey, onStep });
const agent = conversante.agent;

console.log(cabecalho(conversante.model));
if (process.env.GUDMAN_DEBUG === "1" || process.env.GUDY_DEBUG === "1") {
  const tools = agent.toolNames();
  console.log(cor(`Ferramentas: ${tools.length ? tools.join(", ") : "nenhuma"}`, tema.dim));
  if (conversante.arvoreMemoria) {
    console.log(cor(`Memória carregada até o nível ${conversante.niveisArvore}.`, tema.dim));
  }
}
console.log();

const rl = readline.createInterface({ input: stdin, output: stdout });

async function main(): Promise<void> {
  while (true) {
    let input: string;
    try {
      input = await rl.question(promptUsuario());
    } catch {
      break;
    }

    const cmd = input.trim().toLowerCase();
    if (!cmd) continue;
    if (cmd === "/sair" || cmd === "/exit" || cmd === "/quit") break;

    if (cmd === "/limpar" || cmd === "/clear") {
      agent.history.length = 0;
      console.log(cor("Histórico da conversa limpo.\n", tema.dim));
      continue;
    }

    if (cmd === "/ajuda" || cmd === "/help") {
      mostrarAjuda();
      continue;
    }

    if (cmd === "/memorizar") {
      await revisarMemoria({
        rl,
        history: agent.history,
        apiKey,
      });
      continue;
    }
    await conversar(input);
  }
}

async function conversar(input: string): Promise<void> {
  try {
    const answer = await agent.run(input);
    console.log(`${titulo("Gudman ›")} ${answer || "Certo."}\n`);
  } catch (err) {
    atividadeConversa.parar();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(cor(`Erro: ${msg}\n`, tema.red));
  }
}

function mostrarAjuda(): void {
  console.log([
    "",
    titulo("Comandos"),
    `  ${cor("/memorizar", tema.cyan)}  analisa a conversa e abre a revisão de propostas`,
    `  ${cor("/limpar", tema.cyan)}     limpa o histórico desta sessão`,
    `  ${cor("/ajuda", tema.cyan)}      mostra esta ajuda`,
    `  ${cor("/sair", tema.cyan)}       encerra o Gudman`,
    "",
  ].join("\n"));
}

main().finally(() => rl.close());
