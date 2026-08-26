/**
 * Camada de AGENTE.
 *
 * Conceito:
 *  - Um perfil em src/agents/registry.ts define modelo, tools e permissões.
 *  - Código, instruções e definições ficam juntos em src/agents/<agente>/.
 *  - Loop do agente: pergunta -> modelo responde OU pede ferramenta ->
 *    executa -> devolve o resultado -> repete ate a resposta final.
 *
 * O modelo enxerga apenas TEXTO (descricoes). As funcoes reais ficam no
 * registro em src/tools/registry.ts, ligadas pelo nome.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECT_ROOT } from "./project-root";
import {
  chatStep,
  type Message,
  type Tool,
} from "./glm";
import { toolHandlers } from "../tools/registry";

const DEFAULT_MAX_STEPS = 8;

interface LoadedToolDefinition {
  tool: Tool;
  guidance: string; // corpo markdown abaixo do frontmatter
  source: string; // nome do arquivo, para mensagens de erro
}

/** Eventos do loop, para a interface (CLI) poder mostrar o que acontece. */
export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: string }
  | { type: "answer"; content: string }
  | { type: "max_steps" };

export interface AgentOptions {
  apiKey: string;
  /** Obrigatório: agentes nunca herdam o fallback genérico do transporte. */
  model: string;
  instructionsFile: string;
  toolsDir: string;
  /** Lista explícita das ferramentas que este agente pode executar. */
  allowedTools: readonly string[];
  maxSteps?: number;
  /** Limite da resposta de cada chamada ao modelo. */
  maxTokens?: number;
  /** Temperatura baixa (padrao 0.4) deixa o agente mais deterministico. */
  temperature?: number;
  /** Texto extra anexado ao fim do system prompt (ex.: arvore do bundle). */
  systemSuffix?: string;
  onStep?: (event: AgentEvent) => void;
}

export interface AgentRunOptions {
  /** Instrução temporária só para esta execução, sem alterar o agente base. */
  systemSuffix?: string;
  /** Oculta as tools nesta execução; útil em etapas puras de extração. */
  disableTools?: boolean;
  /** Solicita JSON válido ao endpoint em etapas de contrato estruturado. */
  responseFormat?: "text" | "json_object";
  /** Controla o raciocínio profundo por etapa, sem mudar o perfil inteiro. */
  thinking?: "enabled" | "disabled";
  /** Eventos e fragmentos exclusivos desta execução (usados pela web). */
  onStep?: (event: AgentEvent) => void;
  onContent?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  signal?: AbortSignal;
}

export class Agent {
  private readonly instructions: string;
  private readonly toolDefinitions: LoadedToolDefinition[];
  private readonly systemPrompt: string;
  readonly history: Message[] = [];
  readonly model: string;

  constructor(private readonly opts: AgentOptions) {
    if (!opts.model.trim()) throw new Error("O modelo do agente não pode ser vazio.");
    this.model = opts.model;
    this.instructions = loadInstructions(opts.instructionsFile);
    this.toolDefinitions = loadToolDefinitions(opts.toolsDir);
    validarPermissoes(this.toolDefinitions, opts.allowedTools);
    const base = buildSystem(this.instructions, this.toolDefinitions);
    this.systemPrompt = opts.systemSuffix
      ? `${base}\n\n${opts.systemSuffix.trim()}`
      : base;
  }

  /** Lista os nomes das ferramentas expostas ao modelo. */
  toolNames(): string[] {
    return this.toolDefinitions.map((definition) => definition.tool.function.name);
  }

  async run(userInput: string, runOpts: AgentRunOptions = {}): Promise<string> {
    this.history.push({ role: "user", content: userInput });

    // A cada turno reenvia o system + todo o historico (memoria de curto prazo).
    const systemDoTurno = runOpts.systemSuffix
      ? `${this.systemPrompt}\n\n${runOpts.systemSuffix.trim()}`
      : this.systemPrompt;
    const messages: Message[] = [
      { role: "system", content: systemDoTurno },
      ...this.history,
    ];

    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS;
    const emit = (event: AgentEvent): void => {
      this.opts.onStep?.(event);
      runOpts.onStep?.(event);
    };

    for (let step = 0; step < maxSteps; step++) {
      emit({ type: "thinking" });
      const { message, finishReason } = await chatStep(
        messages,
        this.opts.apiKey,
        {
          model: this.opts.model,
          temperature: this.opts.temperature ?? 0.4,
          maxTokens: this.opts.maxTokens,
          responseFormat: runOpts.responseFormat,
          thinking: runOpts.thinking,
          tools: runOpts.disableTools
            ? undefined
            : this.toolDefinitions.map((definition) => definition.tool),
          signal: runOpts.signal,
        },
        runOpts.onContent || runOpts.onReasoning
          ? {
              onContent: runOpts.onContent,
              onReasoning: runOpts.onReasoning,
            }
          : undefined,
      );
      messages.push(message);

      // Sem chamadas de ferramenta = resposta final.
      if (finishReason !== "tool_calls" || !message.tool_calls?.length) {
        this.history.push({ role: "assistant", content: message.content });
        emit({ type: "answer", content: message.content });
        return message.content;
      }

      // Executa cada ferramenta pedida e devolve o resultado ao modelo.
      for (const call of message.tool_calls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // argumentos invalidos -> segue com args vazios
        }
        emit({ type: "tool_call", name, args });

        const handler = this.opts.allowedTools.includes(name)
          ? toolHandlers[name]
          : undefined;
        let result: string;
        if (!handler) {
          result = `Erro: ferramenta desconhecida "${name}".`;
        } else {
          try {
            result = await handler(args);
          } catch (err) {
            result = `Erro ao executar "${name}": ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        emit({ type: "tool_result", name, result });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    emit({ type: "max_steps" });
    return "(o agente atingiu o limite de passos sem produzir uma resposta final)";
  }
}

// ---------------------------------------------------------------------------
// Carregamento dos arquivos de configuracao
// ---------------------------------------------------------------------------

export function loadInstructions(file: string): string {
  const path = resolve(PROJECT_ROOT, file);
  if (!existsSync(path)) {
    throw new Error(`Arquivo de instruções não encontrado: ${file}`);
  }
  return readFileSync(path, "utf8").trim();
}

export function loadToolDefinitions(dir: string): LoadedToolDefinition[] {
  const abs = resolve(PROJECT_ROOT, dir);
  if (!existsSync(abs)) {
    throw new Error(`Diretório de definições de tools não encontrado: ${dir}`);
  }

  const files = readdirSync(abs).filter((f) => f.endsWith(".md"));
  return files.map((f) => parseToolFile(readFileSync(join(abs, f), "utf8"), f));
}

function validarPermissoes(
  definitions: readonly LoadedToolDefinition[],
  allowedTools: readonly string[],
): void {
  const permitidas = new Set(allowedTools);
  const carregadas = new Set<string>();
  for (const definition of definitions) {
    const nome = definition.tool.function.name;
    if (carregadas.has(nome)) {
      throw new Error(`A tool "${nome}" foi declarada mais de uma vez.`);
    }
    carregadas.add(nome);
    if (!permitidas.has(nome)) {
      throw new Error(
        `A tool "${nome}" (${definition.source}) não está permitida no perfil deste agente.`,
      );
    }
    if (!toolHandlers[nome]) {
      throw new Error(
        `A tool "${nome}" (${definition.source}) não possui handler registrado.`,
      );
    }
  }
  for (const nome of permitidas) {
    if (!carregadas.has(nome)) {
      throw new Error(
        `A ferramenta permitida "${nome}" não possui definição no diretório de tools do agente.`,
      );
    }
  }
}

function buildSystem(instructions: string, definitions: LoadedToolDefinition[]): string {
  const guidance = definitions
    .filter((s) => s.guidance.trim().length > 0)
    .map((s) => `### ${s.tool.function.name}\n${s.guidance.trim()}`)
    .join("\n\n");

  return guidance
    ? `${instructions}\n\n## Ferramentas (orientações de uso)\n${guidance}`
    : instructions;
}

/** Lê o frontmatter (--- ... ---) de uma definição de tool.
 *  Formato esperado:
 *    ---
 *    name: <nome>
 *    description: <descricao pro modelo>
 *    parameters: <JSON Schema em uma linha>
 *    ---
 *    (markdown opcional com orientacoes) */
function parseToolFile(content: string, source: string): LoadedToolDefinition {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Tool "${source}" sem bloco de frontmatter (--- ... ---).`,
    );
  }
  const header = match[1];
  const body = match[2];

  const meta: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const name = meta.name;
  const description = meta.description;
  if (!name || !description) {
    throw new Error(
      `Tool "${source}": 'name' e 'description' são obrigatórios no frontmatter.`,
    );
  }

  let parameters: object = { type: "object", properties: {} };
  if (meta.parameters) {
    try {
      parameters = JSON.parse(meta.parameters);
    } catch {
      throw new Error(
        `Tool "${source}": 'parameters' precisa ser um JSON válido em uma linha.`,
      );
    }
  }

  return {
    tool: { type: "function", function: { name, description, parameters } },
    guidance: body.trim(),
    source,
  };
}
