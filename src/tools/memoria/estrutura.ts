import { normalizar } from "./frontmatter";

export type TipoMemoria = "Pessoa" | "Grupo" | "Conhecimento" | "Evento" | "Lugar" | "Projeto";

export interface SecaoMemoria {
  readonly nome: string;
  readonly finalidade: string;
}

export interface EstruturaMemoria {
  readonly type: TipoMemoria;
  readonly definicao: string;
  readonly pasta: string;
  readonly campos: readonly string[];
  readonly secoes: readonly SecaoMemoria[];
}

/** Contrato canônico compartilhado por templates, preenchedor e validadores. */
export const ESTRUTURAS_MEMORIA: readonly EstruturaMemoria[] = [
  {
    type: "Pessoa",
    definicao: "Um indivíduo identificável. A ficha reúne dados próprios da pessoa; episódios extensos pertencem a Evento e dados coletivos pertencem a Grupo.",
    pasta: "social/pessoas",
    campos: [
      "type", "title", "apelido", "data_nascimento", "description", "categoria",
      "vinculo", "proximidade", "afinidade", "tags",
    ],
    secoes: [
      { nome: "Informações Gerais", finalidade: "Dados biográficos e atuais: profissão, formação, família, moradia e informações importantes que situam a pessoa." },
      { nome: "Princípios e Valores", finalidade: "Crenças, convicções, prioridades e valores atribuídos à pessoa; não deduzir apenas de um comportamento isolado." },
      { nome: "Características Físicas", finalidade: "Aparência e características físicas observáveis, sem avaliações de personalidade." },
      { nome: "Personalidade", finalidade: "Traços relativamente estáveis, autodeclarados ou sustentados por evidências; preservar atribuição e incerteza quando inferidos." },
      { nome: "Histórico", finalidade: "Cronologia, origem do vínculo, mudanças e marcos biográficos; acontecimentos extensos devem ser linkados como Eventos." },
      { nome: "Interesses", finalidade: "Catálogo conciso de gostos, hobbies e preferências recorrentes, em bullets; episódios e ocorrências pertencem a Histórico/Evento." },
      { nome: "Curiosidades", finalidade: "Fatos duráveis e distintivos que não se encaixam melhor nas outras seções." },
      { nome: "Relações", finalidade: "Modelo mental direcional da pessoa dona da ficha sobre o núcleo de outra pessoa: caráter, personalidade, valores e sentimentos duráveis. Cada alvo usa um subtítulo com link e bullets abaixo; fatos, episódios, parentesco, convivência e papéis contextuais não entram." },
    ],
  },
  {
    type: "Grupo",
    definicao: "Um coletivo reconhecível e relativamente estável, como turma, equipe, família ou círculo de amigos; não uma reunião pontual. O frontmatter membros identifica Pessoas cadastradas por ID.",
    pasta: "social/grupos",
    campos: ["type", "title", "description", "tipo", "membros", "tags"],
    secoes: [
      { nome: "Sobre", finalidade: "Identidade, origem, propósito, história e dinâmica geral do grupo." },
      { nome: "Membros", finalidade: "Pessoas que compõem ou compuseram o grupo, preferencialmente com links e papéis relevantes." },
      { nome: "Humor", finalidade: "Estilo de humor coletivo, piadas recorrentes, memes e referências internas reconhecidas pelo grupo; não registrar uma brincadeira isolada como padrão." },
    ],
  },
  {
    type: "Conhecimento",
    definicao: "Aprendizado, opinião, hipótese ou reflexão que o dono do bundle expôs deliberadamente como conhecimento próprio; falas casuais de terceiros não entram aqui.",
    pasta: "conhecimento",
    campos: ["type", "title", "description", "natureza", "tags"],
    secoes: [
      { nome: "Contexto", finalidade: "Origem, motivação, escopo e situações em que o conhecimento se aplica." },
      { nome: "Detalhes", finalidade: "Conteúdo principal do aprendizado, opinião, hipótese ou reflexão." },
      { nome: "Alternativas", finalidade: "Abordagens concorrentes, contrapontos ou opções comparadas, quando existirem." },
    ],
  },
  {
    type: "Projeto",
    definicao: "Uma iniciativa com objetivo identificável, em ideia, planejamento, execução ou encerrada. Registra o trabalho ou intenção compartilhada; participantes referencia Pessoas/Grupos por ID e reuniões/marcos continuam sendo Eventos.",
    pasta: "projetos",
    campos: ["type", "title", "description", "estado", "inicio", "fim", "participantes", "tags"],
    secoes: [
      { nome: "Visão Geral", finalidade: "Objetivo, problema, escopo e resultado pretendido pela iniciativa, sem transformar hipóteses em decisões." },
      { nome: "Estado Atual", finalidade: "Situação conhecida agora: ideia, planejamento, execução, bloqueios e condições ainda indefinidas." },
      { nome: "Participantes", finalidade: "Pessoas, grupos e organizações envolvidos, com links e papéis somente quando confirmados." },
      { nome: "Decisões", finalidade: "Decisões efetivamente tomadas e critérios acordados; propostas em debate devem permanecer explicitamente marcadas como propostas." },
      { nome: "Próximos Passos", finalidade: "Ações futuras explicitamente combinadas, responsáveis e dependências; não inventar tarefas a partir de uma discussão." },
      { nome: "Histórico", finalidade: "Origem, mudanças e marcos do projeto, preferencialmente com links para Eventos relacionados." },
    ],
  },
  {
    type: "Evento",
    definicao: "Algo situado no tempo: Periodo para uma configuração sustentada, Acontecimento para um episódio delimitado e Encontro para uma ocasião interpessoal relevante. participantes e lugares identificam entidades cadastradas por ID.",
    pasta: "eventos",
    campos: ["type", "title", "description", "data", "datafim", "tipo", "participantes", "lugares", "tags"],
    secoes: [
      { nome: "Contexto", finalidade: "O que ocorreu, quando aproximadamente, antecedentes e por que o evento é relevante." },
      { nome: "Pessoas", finalidade: "Participantes e seus papéis, com links para fichas de Pessoa quando disponíveis." },
      { nome: "Lugar", finalidade: "Local ou locais associados, com links para fichas de Lugar quando disponíveis." },
      { nome: "Detalhes", finalidade: "Desdobramentos e fatos importantes do evento que não pertencem às seções anteriores." },
    ],
  },
  {
    type: "Lugar",
    definicao: "Um local físico ou geográfico identificável e reutilizável, como cidade, escola, casa, região ou estabelecimento.",
    pasta: "lugares",
    campos: ["type", "title", "description", "tipo", "tags"],
    secoes: [
      { nome: "Moradia", finalidade: "Quem morou ou mora no local e em quais períodos, quando isso for relevante." },
      { nome: "Visitas", finalidade: "Visitas e passagens recorrentes ou relevantes; episódios marcantes podem apontar para Eventos." },
      { nome: "Notas", finalidade: "Características duráveis, localização, função e contexto geral do lugar." },
    ],
  },
] as const;

export function obterEstruturaMemoria(type: string): EstruturaMemoria | undefined {
  const chave = normalizar(type.trim());
  return ESTRUTURAS_MEMORIA.find((item) => normalizar(item.type) === chave);
}

export function nomeSecaoCanonica(type: string, secao: string): string | undefined {
  const estrutura = obterEstruturaMemoria(type);
  const chave = normalizarTitulo(secao);
  return estrutura?.secoes.find((item) => normalizarTitulo(item.nome) === chave)?.nome;
}

/** Regras verificáveis de conteúdo que impedem misturar contratos semânticos. */
export function erroConteudoSecao(
  type: string,
  secao: string,
  conteudo: string,
): string | undefined {
  const estrutura = obterEstruturaMemoria(type);
  const canonica = nomeSecaoCanonica(type, secao);
  if (!estrutura || !canonica || estrutura.type !== "Pessoa") return undefined;

  if (canonica === "Relações") return erroConteudoRelacoes(conteudo);
  if (canonica !== "Interesses") return undefined;

  const linhas = conteudo.split(/\r?\n/u).map((linha) => linha.trim()).filter(Boolean);
  if (!linhas.length) return "Interesses precisa conter ao menos um item.";
  for (const linha of linhas) {
    const item = linha.match(/^- \*\*([^*\r\n]+)\*\*(?:\s+(.+))?$/u);
    const detalhe = item?.[2] ?? "";
    if (!item || [...(item[1] ?? "")].length > 60 || [...detalhe].length > 72 || detalhe.includes(";")) {
      return "Interesses aceita somente itens concisos em uma linha, no formato '- **Interesse** detalhe curto.'. Episódios e ocorrências narradas pertencem a Histórico/Evento ou devem ser omitidos.";
    }
  }
  return undefined;
}

function erroConteudoRelacoes(conteudo: string): string | undefined {
  const linhas = conteudo.split(/\r?\n/u);
  const alvos = new Set<string>();
  let alvoAtual: string | undefined;
  let itensDoAlvo = 0;

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();
    if (!linha) continue;
    const titulo = linha.match(/^### \[([^\]\r\n]+)\]\((\/social\/pessoas\/[a-z0-9-]+\.md)\)$/u);
    if (titulo) {
      if (alvoAtual && itensDoAlvo === 0) {
        return `Relações precisa ter ao menos uma opinião abaixo de "${alvoAtual}".`;
      }
      const path = titulo[2] ?? "";
      if (alvos.has(path)) {
        return `Relações contém a mesma pessoa mais de uma vez: "${path}". Reúna as opiniões sob um único subtítulo.`;
      }
      alvos.add(path);
      alvoAtual = titulo[1];
      itensDoAlvo = 0;
      continue;
    }
    if (/^###\s/u.test(linha)) {
      return "Em Relações, use o subtítulo exato '### [Nome](/social/pessoas/slug.md)'.";
    }
    if (!alvoAtual || !/^- \S/u.test(linha)) {
      return "Relações aceita somente blocos no formato '### [Nome](/social/pessoas/slug.md)' seguidos de bullets de opinião.";
    }
    if (/\b(?:fala|obs)_\d+\b/iu.test(linha)
      || /\((?:[^)]*\b(?:call|declaração própria|opinião de|percepção de|confiança (?:alta|média|media|baixa))\b[^)]*)\)/iu.test(linha)) {
      return "Relações guarda a percepção permanente, não proveniência de análise, IDs de fala, calls ou níveis de confiança.";
    }
    itensDoAlvo += 1;
  }

  if (alvoAtual && itensDoAlvo === 0) {
    return `Relações precisa ter ao menos uma opinião abaixo de "${alvoAtual}".`;
  }
  return undefined;
}

export function descreverEstruturaMemoria(type: string): string | undefined {
  const estrutura = obterEstruturaMemoria(type);
  if (!estrutura) return undefined;
  return [
    `Definição operacional: ${estrutura.definicao}`,
    `Pasta: ${estrutura.pasta}`,
    "Seções aceitas, na ordem canônica:",
    ...estrutura.secoes.map((secao, index) => `${index + 1}. ${secao.nome} — ${secao.finalidade}`),
  ].join("\n");
}

/** Garante que uma criação use somente as seções canônicas. Em atualização,
 * seções legadas já existentes podem ser preservadas, mas não introduzidas. */
export function erroEstruturaCorpo(
  type: string,
  corpo: string,
  corpoAnterior?: string,
): string | undefined {
  const estrutura = obterEstruturaMemoria(type);
  if (!estrutura) return `tipo desconhecido "${type}".`;
  const atuais = extrairTitulosH2(corpo);
  const anteriores = corpoAnterior === undefined ? [] : extrairTitulosH2(corpoAnterior);
  const anterioresNormalizados = new Set(anteriores.map(normalizarTitulo));
  const canonicas = new Map(
    estrutura.secoes.map((secao, index) => [normalizarTitulo(secao.nome), { ...secao, index }]),
  );
  const vistos = new Set<string>();
  let ultimaOrdem = -1;

  for (const titulo of atuais) {
    const chave = normalizarTitulo(titulo);
    if (vistos.has(chave)) return `seção duplicada no corpo: "${titulo}".`;
    vistos.add(chave);
    const canonica = canonicas.get(chave);
    if (!canonica) {
      if (!anterioresNormalizados.has(chave)) {
        return `seção não permitida para ${estrutura.type}: "${titulo}". Use: ${estrutura.secoes.map((item) => item.nome).join(", ")}.`;
      }
      continue;
    }
    const existiaAssim = anteriores.some((item) => item === titulo);
    if (titulo !== canonica.nome && !existiaAssim) {
      return `use o título canônico "## ${canonica.nome}" em vez de "## ${titulo}".`;
    }
    if (canonica.index < ultimaOrdem) {
      return `a seção "${canonica.nome}" está fora da ordem canônica de ${estrutura.type}.`;
    }
    ultimaOrdem = canonica.index;
  }

  if (corpoAnterior === undefined) {
    const ausentes = estrutura.secoes
      .filter((secao) => !vistos.has(normalizarTitulo(secao.nome)))
      .map((secao) => secao.nome);
    if (ausentes.length) return `corpo de ${estrutura.type} sem seção(ões): ${ausentes.join(", ")}.`;
  } else {
    const removidas = estrutura.secoes
      .filter((secao) => anterioresNormalizados.has(normalizarTitulo(secao.nome)))
      .filter((secao) => !vistos.has(normalizarTitulo(secao.nome)))
      .map((secao) => secao.nome);
    if (removidas.length) {
      return `atualização remove seção(ões) estruturais existentes: ${removidas.join(", ")}.`;
    }
  }
  if (estrutura.type === "Pessoa") {
    const relacoes = extrairConteudoH2(corpo, "Relações");
    if (relacoes !== undefined) {
      const erroRelacoes = erroConteudoSecao("Pessoa", "Relações", relacoes);
      if (erroRelacoes) return erroRelacoes;
    }
  }
  return undefined;
}

export function normalizarTitulo(value: string): string {
  return normalizar(value).replace(/\s+/g, " ").trim();
}

function extrairTitulosH2(markdown: string): string[] {
  return [...markdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)].map((match) => match[1] ?? "");
}

function extrairConteudoH2(markdown: string, titulo: string): string | undefined {
  const linhas = markdown.split(/\r?\n/u);
  let inicio = -1;
  for (let index = 0; index < linhas.length; index++) {
    const match = linhas[index]?.match(/^##[ \t]+(.+?)[ \t]*$/u);
    if (match?.[1] && normalizarTitulo(match[1]) === normalizarTitulo(titulo)) {
      inicio = index + 1;
      break;
    }
  }
  if (inicio < 0) return undefined;
  let fim = linhas.length;
  for (let index = inicio; index < linhas.length; index++) {
    if (/^##[ \t]+/u.test(linhas[index] ?? "")) {
      fim = index;
      break;
    }
  }
  return linhas.slice(inicio, fim).join("\n").trim();
}
