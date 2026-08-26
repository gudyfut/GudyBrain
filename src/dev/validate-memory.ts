import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../core/project-root";
import { parseFrontmatter } from "../tools/memoria/frontmatter";
import {
  interpretarDocumentoEditavel,
  montarPreviaMemoria,
} from "../tools/memoria/documento-editavel";
import { criarIdMemoria, idMemoriaValido } from "../tools/memoria/ids";
import { memoriaBuscar } from "../tools/memoria/buscar";
import { memoriaListar } from "../tools/memoria/listar";
import {
  limparFila,
  memoriaPrepararCandidato,
  obterFila,
  removerMarcadoresEvidencia,
} from "../tools/memoria/candidato";
import { erroEstruturaCorpo } from "../tools/memoria/estrutura";
import { preencherDocumentoCandidato } from "../tools/memoria/preencher";
import {
  camposDoTipo,
  erroSchemaAtualizacao,
  erroSchemaCriacao,
} from "../tools/memoria/schema";

const raiz = resolve(PROJECT_ROOT, "memory");
const erros: string[] = [];
const ids = new Map<string, { path: string; type: string }>();
const arquivos: string[] = [];
const referenciasEstruturadas: Array<{ path: string; field: string; ids: readonly string[] }> = [];

if (!existsSync(resolve(raiz, "index.md"))) {
  console.log(
    "⚠ Bundle de memória ausente — nada a validar. Execute `npm run memory:init` para criar o bundle de demonstração e rodar esta validação.",
  );
  process.exit(0);
}

coletarConceitos(raiz, arquivos);

for (const arquivo of arquivos) {
  const path = relative(PROJECT_ROOT, arquivo).replace(/\\/g, "/");
  const conteudo = readFileSync(arquivo, "utf8");
  if (/\b(?:fala|obs)_\d+\b/iu.test(conteudo)) {
    erros.push(`${path}: contém identificador interno de evidência no conteúdo permanente`);
  }
  const bloco = conteudo.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (bloco === undefined) {
    erros.push(`${path}: frontmatter ausente ou inválido`);
    continue;
  }

  const { campos, corpo } = parseFrontmatter(conteudo);
  try {
    interpretarDocumentoEditavel(conteudo, conteudo);
  } catch (error) {
    erros.push(`${path}: incompatível com o editor web: ${error instanceof Error ? error.message : String(error)}`);
  }
  const type = typeof campos.type === "string" ? campos.type : "";
  const obrigatorios = camposDoTipo(type);
  if (!obrigatorios) {
    erros.push(`${path}: type desconhecido ou ausente`);
    continue;
  }
  const erroEstrutura = erroEstruturaCorpo(type, corpo, corpo);
  if (erroEstrutura) erros.push(`${path}: estrutura inválida: ${erroEstrutura}`);
  for (const campo of [...obrigatorios, "id", "status", "generated"]) {
    if (!temChave(bloco, campo)) erros.push(`${path}: campo obrigatório ausente: ${campo}`);
  }

  if (type.trim().toLowerCase() === "pessoa") {
    validarSecoesPessoa(conteudo, path);
  }
  if (type.trim().toLowerCase() === "grupo") {
    const erroGrupo = erroEstruturaCorpo(type, corpo);
    if (erroGrupo) erros.push(`${path}: Grupo fora do template atual: ${erroGrupo}`);
  }
  for (const field of camposReferencia(type)) {
    const values = campos[field];
    if (!Array.isArray(values)) continue;
    referenciasEstruturadas.push({ path, field, ids: values });
  }

  const id = campos.id;
  if (!idMemoriaValido(id)) {
    erros.push(`${path}: id ausente ou fora do formato mem_<uuid-v4>`);
    continue;
  }
  const anterior = ids.get(id);
  if (anterior) erros.push(`${path}: id duplicado com ${anterior.path}: ${id}`);
  else ids.set(id, { path, type });
}

validarReferenciasEstruturadas();

validarProtecaoDosMetadados();
validarLimpezaDeEvidencias();
await validarProtecaoDaFila();
validarPreenchedorEstrutural();
await validarGeracaoEBusca();
validarIdentidadesDiscord();

if (erros.length) {
  for (const erro of erros) console.error(`✗ ${erro}`);
  process.exitCode = 1;
} else {
  console.log(`✓ Bundle de memória: ${arquivos.length} conceito(s), IDs válidos e únicos.`);
}

function coletarConceitos(dir: string, out: string[]): void {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith(".")) continue;
    const full = join(dir, nome);
    const stat = statSync(full);
    if (stat.isDirectory()) coletarConceitos(full, out);
    else if (extname(nome) === ".md" && nome !== "index.md") out.push(full);
  }
}

function temChave(frontmatter: string, chave: string): boolean {
  return new RegExp(`^\\s*${chave}\\s*:`, "m").test(frontmatter);
}

function camposReferencia(type: string): readonly string[] {
  const fields: Readonly<Record<string, readonly string[]>> = {
    grupo: ["membros"],
    projeto: ["participantes"],
    evento: ["participantes", "lugares"],
  };
  return fields[type.trim().toLowerCase()] ?? [];
}

function validarReferenciasEstruturadas(): void {
  for (const reference of referenciasEstruturadas) {
    for (const id of reference.ids) {
      const target = ids.get(id);
      if (!target) {
        erros.push(`${reference.path}: ${reference.field} referencia ID inexistente ${id}`);
        continue;
      }
      const allowed = reference.field === "lugares"
        ? ["lugar"]
        : reference.field === "membros"
          ? ["pessoa"]
          : ["pessoa", "grupo"];
      if (!allowed.includes(target.type.toLowerCase())) {
        erros.push(`${reference.path}: ${reference.field} referencia ${target.type}, esperado ${allowed.join("/")}: ${id}`);
      }
    }
  }
}

function validarSecoesPessoa(conteudo: string, path: string): void {
  const secoes = [...conteudo.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)]
    .map((resultado) => resultado[1]);
  const esperadaPrimeira = "Informações Gerais";
  const esperadaSegunda = "Princípios e Valores";
  const esperadaUltima = "Relações";

  if (secoes[0] !== esperadaPrimeira) {
    erros.push(`${path}: primeira seção de Pessoa deve ser '${esperadaPrimeira}'`);
  }
  if (secoes[1] !== esperadaSegunda) {
    erros.push(`${path}: segunda seção de Pessoa deve ser '${esperadaSegunda}'`);
  }
  if (secoes.at(-1) !== esperadaUltima) {
    erros.push(`${path}: última seção de Pessoa deve ser '${esperadaUltima}'`);
  }
}

function validarProtecaoDosMetadados(): void {
  const pessoa = {
    type: "Pessoa",
    title: "Teste",
    apelido: null,
    data_nascimento: null,
    description: null,
    categoria: null,
    vinculo: null,
    proximidade: null,
    afinidade: null,
    tags: [],
  };
  for (const campo of ["id", "status", "generated"]) {
    if (!erroSchemaCriacao({ ...pessoa, [campo]: "indevido" })) {
      erros.push(`schema de criação aceita o campo gerenciado: ${campo}`);
    }
    if (!erroSchemaAtualizacao({ [campo]: "indevido" }, "Pessoa")) {
      erros.push(`schema de atualização aceita o campo gerenciado: ${campo}`);
    }
  }
}

function validarLimpezaDeEvidencias(): void {
  const original = [
    "- O encontro começou às 22:00 (fala_000094, 22:09:43).",
    "- Outro fato [obs_00042, Usuário, 22:10:13].",
    "- Horário real: 05:30.",
  ].join("\n");
  const limpo = removerMarcadoresEvidencia(original);
  if (/\b(?:fala|obs)_\d+\b/iu.test(limpo) || limpo.includes("22:09:43") || limpo.includes("22:10:13")) {
    erros.push("limpeza do candidato preservou metadados internos de evidência");
  }
  if (!limpo.includes("começou às 22:00") || !limpo.includes("Horário real: 05:30")) {
    erros.push("limpeza do candidato removeu um horário que fazia parte da memória");
  }
}

async function validarProtecaoDaFila(): Promise<void> {
  limparFila();
  const resposta = await memoriaPrepararCandidato({
    acao: "criar",
    path: "validacao-local/candidato-inexistente",
    tipo_memoria: "Pessoa",
    frontmatter: { id: "mem_00000000-0000-4000-8000-000000000000" },
    alteracoes: [{ secao: "Informações Gerais", conteudo: "Teste", modo: "acrescentar" }],
    motivo: "teste local",
    natureza_proposta: "explicita",
    evidencias: ["teste local"],
  });
  if (!resposta.startsWith("Erro:") || obterFila().length !== 0) {
    erros.push("fila de candidatos aceita alteração de id gerenciado");
  }
  limparFila();
}

function validarPreenchedorEstrutural(): void {
  const criado = preencherDocumentoCandidato({
    type: "Pessoa",
    frontmatter: { title: "Pessoa de teste", categoria: "Conhecido" },
    alteracoes: [
      {
        secao: "Relações",
        conteudo: "### [Ana](/social/pessoas/ana.md)\n- Considera Ana leal e confiável.",
        modo: "acrescentar",
      },
      { secao: "Informações Gerais", conteudo: "Trabalha com testes.", modo: "acrescentar" },
      { secao: "Interesses", conteudo: "- **League of Legends** modo Arena.", modo: "acrescentar" },
    ],
  });
  if (criado.frontmatter.data_nascimento !== null || !Array.isArray(criado.frontmatter.tags)) {
    erros.push("preenchedor não completou campos desconhecidos com null/[]");
  }
  const headings = [...criado.corpo.matchAll(/^##\s+(.+)$/gm)].map((item) => item[1]);
  if (headings[0] !== "Informações Gerais" || headings.at(-1) !== "Relações") {
    erros.push("preenchedor não respeitou a ordem canônica de Pessoa");
  }
  if (erroEstruturaCorpo("Pessoa", criado.corpo)) {
    erros.push("preenchedor produziu uma criação estruturalmente inválida");
  }
  if (/^## .+\n\n(?!## )/mu.test(criado.corpo)) {
    erros.push("preenchedor deixou linha vazia decorativa após título de seção");
  }
  if (/^\s*[-*+] .+\n\n\s*[-*+] /mu.test(criado.corpo)) {
    erros.push("preenchedor deixou linha vazia entre itens consecutivos");
  }
  const atualizado = preencherDocumentoCandidato({
    type: "Pessoa",
    frontmatter: { afinidade: 4 },
    alteracoes: [{ secao: "Histórico", conteudo: "Conheceram-se na escola.", modo: "acrescentar" }],
    conteudoAtual: montarPreviaMemoria("", criado.frontmatter, criado.corpo),
  });
  if (!atualizado.corpo.includes("Trabalha com testes.") || !atualizado.corpo.includes("Conheceram-se na escola.")) {
    erros.push("preenchedor de atualização não preservou e integrou o conteúdo");
  }
  if (atualizado.frontmatter.afinidade !== 4 || atualizado.frontmatter.categoria !== "Conhecido") {
    erros.push("preenchedor de atualização não preservou e mesclou o frontmatter");
  }
  const relacaoAtualizada = preencherDocumentoCandidato({
    type: "Pessoa",
    frontmatter: {},
    alteracoes: [{
      secao: "Relações",
      conteudo: "### [Ana Silva](/social/pessoas/ana.md)\n- Admira a coragem de Ana.",
      modo: "acrescentar",
    }],
    conteudoAtual: montarPreviaMemoria("", criado.frontmatter, criado.corpo),
  });
  if (
    (relacaoAtualizada.corpo.match(/^### \[Ana Silva\]\(\/social\/pessoas\/ana\.md\)$/gmu) ?? []).length !== 1
    || !relacaoAtualizada.corpo.includes("Considera Ana leal e confiável.")
    || !relacaoAtualizada.corpo.includes("Admira a coragem de Ana.")
  ) {
    erros.push("preenchedor não reuniu novas opiniões sob o alvo já existente em Relações");
  }
  const corpoSemRelacoes = criado.corpo.replace(/\n\n## Relações[\s\S]*$/u, "");
  if (!erroEstruturaCorpo("Pessoa", corpoSemRelacoes, criado.corpo)) {
    erros.push("validador permitiu remover uma seção estrutural existente");
  }
  const grupo = preencherDocumentoCandidato({
    type: "Grupo",
    frontmatter: { title: "Grupo de teste" },
    alteracoes: [{ secao: "Humor", conteudo: "- Referência interna recorrente.", modo: "acrescentar" }],
  });
  if (!grupo.corpo.includes("## Humor") || grupo.corpo.indexOf("## Humor") < grupo.corpo.indexOf("## Membros")) {
    erros.push("preenchedor não criou Humor na ordem canônica de Grupo");
  }
  const projeto = preencherDocumentoCandidato({
    type: "Projeto",
    frontmatter: { title: "Projeto de teste", estado: "Ideia" },
    alteracoes: [
      { secao: "Visão Geral", conteudo: "Iniciativa local de validação.", modo: "acrescentar" },
      { secao: "Decisões", conteudo: "- Nenhuma decisão tomada.", modo: "acrescentar" },
    ],
  });
  if (
    !projeto.corpo.includes("## Estado Atual")
    || !projeto.corpo.includes("## Próximos Passos")
    || projeto.frontmatter.inicio !== null
    || !Array.isArray(projeto.frontmatter.participantes)
  ) {
    erros.push("preenchedor não montou o contrato canônico de Projeto");
  }
  try {
    preencherDocumentoCandidato({
      type: "Pessoa",
      frontmatter: { title: "Teste" },
      alteracoes: [{ secao: "Vida profissional", conteudo: "Inválido", modo: "acrescentar" }],
    });
    erros.push("preenchedor aceitou seção inventada pelo agente");
  } catch {
    // esperado
  }
  try {
    preencherDocumentoCandidato({
      type: "Pessoa",
      frontmatter: { title: "Teste" },
      alteracoes: [{
        secao: "Interesses",
        conteudo: "- **League of Legends** joga todo fim de semana com a turma do prédio; prefere suportes.",
        modo: "acrescentar",
      }],
    });
    erros.push("preenchedor aceitou narrativa livre em Interesses");
  } catch {
    // esperado
  }
  try {
    preencherDocumentoCandidato({
      type: "Pessoa",
      frontmatter: { title: "Teste" },
      alteracoes: [{
        secao: "Relações",
        conteudo: "- [Ana](/social/pessoas/ana.md) — amizade.",
        modo: "acrescentar",
      }],
    });
    erros.push("preenchedor aceitou o formato antigo e não direcional de Relações");
  } catch {
    // esperado
  }
  try {
    preencherDocumentoCandidato({
      type: "Pessoa",
      frontmatter: { title: "Teste" },
      alteracoes: [{
        secao: "Relações",
        conteudo: "### [Ana](/social/pessoas/ana.md)\n- Considera Ana leal (declaração própria, call 10/08/2026).",
        modo: "acrescentar",
      }],
    });
    erros.push("preenchedor aceitou proveniência de call em Relações");
  } catch {
    // esperado
  }
}

async function validarGeracaoEBusca(): Promise<void> {
  const gerados = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const id = criarIdMemoria();
    if (!idMemoriaValido(id)) erros.push(`gerador produziu id inválido: ${id}`);
    gerados.add(id);
  }
  if (gerados.size !== 100) erros.push("gerador de IDs produziu duplicidade local");

  const primeiro = ids.entries().next().value as
    | [string, { path: string; type: string }]
    | undefined;
  if (!primeiro) return;
  const [id, conceito] = primeiro;
  const resultado = await memoriaBuscar({ id });
  const pathRelativo = conceito.path.replace(/^memory\//, "");
  if (!resultado.includes(pathRelativo)) {
    erros.push(`busca por id não resolveu ${id} para ${conceito.path}`);
  }
  const invalido = await memoriaBuscar({ id: "mem_invalido" });
  if (!invalido.startsWith("Erro nos filtros:")) {
    erros.push("busca aceita id de memória inválido");
  }
  const projects = await memoriaListar({ pasta: "projetos" });
  const projetoComParticipantes = referenciasEstruturadas.find(
    (item) => item.path.startsWith("memory/projetos/") && item.field === "participantes" && item.ids.length > 0,
  );
  if (projetoComParticipantes) {
    const participante = projetoComParticipantes.ids[0];
    if (!projects.includes("participantes=[") || !projects.includes(participante ?? "")) {
      erros.push("listagem de Projetos não expõe assinatura de participantes resolvida");
    }
    const relatedProjects = await memoriaBuscar({
      type: "Projeto",
      relacionado_a_id: participante,
    });
    const caminhoProjeto = projetoComParticipantes.path.replace(/^memory\//, "");
    if (!relatedProjects.includes(caminhoProjeto)) {
      erros.push("busca relacional por ID não encontrou Projetos do participante");
    }
  } else if (!projects.includes("participantes=[")) {
    erros.push("listagem de Projetos não expõe assinatura de participantes resolvida");
  }
}

function validarIdentidadesDiscord(): void {
  const arquivo = resolve(PROJECT_ROOT, "discordbot/config/identidades_discord.json");
  if (!existsSync(arquivo)) return;
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    erros.push("discordbot/config/identidades_discord.json: JSON inválido");
    return;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    erros.push("identidades Discord: configuração precisa ser um objeto");
    return;
  }
  const dados = config as Record<string, unknown>;
  const creator = dados.creator_person_id;
  const mapa = dados.person_id_by_discord_id;
  if (!idMemoriaValido(creator) || ids.get(creator)?.type.toLowerCase() !== "pessoa") {
    erros.push("identidades Discord: creator_person_id não aponta para uma Pessoa válida");
  }
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) {
    erros.push("identidades Discord: person_id_by_discord_id precisa ser um objeto");
    return;
  }
  let creatorRelacionado = false;
  for (const [discordId, personId] of Object.entries(mapa)) {
    if (!/^\d+$/.test(discordId)) erros.push(`identidades Discord: ID inválido: ${discordId}`);
    if (!idMemoriaValido(personId) || ids.get(personId)?.type.toLowerCase() !== "pessoa") {
      erros.push(`identidades Discord: ${discordId} não aponta para uma Pessoa válida`);
    }
    if (personId === creator) creatorRelacionado = true;
  }
  if (!creatorRelacionado) {
    erros.push("identidades Discord: o criador não possui uma conta relacionada");
  }
}
