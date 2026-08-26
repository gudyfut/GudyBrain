# Arquitetura de agentes

## Componentes

O GudyBrain possui quatro agentes, um preenchedor determinístico e uma fronteira
humana:

| Componente | Entrada | Permissões | Saída |
| --- | --- | --- | --- |
| Gudman | histórico da sessão | hora e leitura de memória | resposta ao usuário |
| Analista de call | transcrição multivoz em blocos | leitura dirigida | `analise-call.json` e `.md` |
| Curador de chat | falas do usuário e do Gudman | leitura, template e preparação | candidatos de conversa |
| Curador de call | relatório do Analista | leitura, preparação e auditoria | candidatos + cobertura |
| Preenchedor local | deltas do curador e arquivo atual | nenhuma IA ou escrita | documento completo validado |
| Revisão humana | candidatos | escrita após aprovação | arquivos em `memory/` |

```text
Chat ─► Curador de chat ─┐
                        ├─► deltas por seção ─► preenchedor ─► revisão ─► memory/
Call ─► Analista ─► grounding indicativo ─► Curador de call ─┘
```

Cada agente nasce sem o histórico interno dos demais. O Gudman não pode propor
ou escrever memória; o Analista não pode preparar candidatos; os curadores não
podem persistir arquivos.

`src/agents/pipeline.ts` declara, para cada agente, etapa, entrada, agente
anterior, garantias e limitações da entrada, saída, consumidor seguinte e
proibições. Esse bloco é injetado automaticamente no prompt. O `registry.ts`
continua responsável somente pela configuração executável: modelo,
temperatura, limites, arquivos e allowlist de ferramentas.

## Por que existem dois curadores

O chat tem o usuário como fonte factual principal e não precisa de auditoria por
observação. A call possui múltiplos autores, confiança variável, opiniões
direcionais, timestamps e possíveis artefatos de transcrição. Misturar essas
regras num único prompt aumentava contexto, ambiguidade e risco de atribuição
incorreta.

O Curador de chat trabalha somente com a conversa direta. O Curador de call
trabalha somente com `analise-call.json`, preserva autoria e deve registrar o
destino de toda observação média ou alta. Ambos compartilham apenas o contrato
semântico dos tipos de memória.

## Grounding e novidade

O Analista extrai primeiro sem memória. Ao final, uma busca determinística
acrescenta até três `possible_memory_matches` por observação usando tipo, texto,
IDs, tags, descrição e referências estruturadas. Isso é uma pista, nunca uma
decisão nem evidência da call.

O Curador consulta novamente a memória vigente porque análises podem estar em
cache. Antes de propor ou encerrar uma observação, ele deve classificá-la como
`nova`, `complementar`, `reforco`, `contradicao`, `ja_memorizada`, `efemera` ou
`ambigua`. O código exige listagem/busca do tipo, leitura integral para
atualizações e comparações com arquivo existente, e impede que repetição ou
conteúdo efêmero gere candidato. Candidatos guardam os paths consultados e a
avaliação de novidade para CLI e interface web.

## Curadoria e preenchimento são etapas diferentes

O modelo não reconstrói mais um arquivo Markdown inteiro. Ele informa:

- conceito, ação e path;
- campos novos ou corrigidos do frontmatter;
- seção canônica e conteúdo novo;
- natureza, evidências e, em calls, IDs das observações.

`src/tools/memoria/preencher.ts` lê o documento atual, completa campos
desconhecidos, preserva conteúdo existente e monta a proposta. Títulos, ordem e
finalidade das seções vêm de `estrutura.ts`, também usado por templates e
validadores. Criação, atualização e editor web validam novamente o corpo antes
da escrita. Seções legadas podem ser preservadas, mas agentes não conseguem
introduzir novas seções fora do contrato.

## Organização

```text
src/agents/
├── registry.ts
├── pipeline.ts
├── conversante/
├── analisador-call/
├── curador-chat/
├── curador-call/
└── curadoria/contexto.ts

src/tools/memoria/
├── estrutura.ts    significado de tipos, campos e seções
├── catalogo.ts      índice e ranking contextual determinístico
├── contextualizacao.ts consultas e classificação de novidade auditáveis
├── contextualizar.ts ferramenta de recuperação curta
├── referencias.ts  integridade de IDs relacionais
├── preencher.ts    deltas semânticos → documento completo
├── candidato.ts    fila temporária e validação da proposta
└── escrever.ts     persistência após aprovação
```

Cada pasta de agente contém `index.ts`, `instructions.md` e `tools/*.md`. O
`registry.ts` é a fonte canônica de modelo, temperatura, limites, caminhos e
allowlist. Uma ferramenta visível precisa ter definição no agente, permissão no
perfil e handler local.

## Análise de calls

Calls longas são divididas em blocos sobrepostos. O Analista consolida contexto,
autoria, entidades, relações, eventos e evidências sem pedir que o Curador releia
a transcrição. `conversation_context` calibra o rigor, mas não vale como
evidência. Conhecimento é filtrado para aceitar somente exposição deliberada
associada ao Criador.

Projetos, Grupos e Eventos carregam uma assinatura curta no frontmatter:
`participantes`, `membros` e `lugares` usam IDs imutáveis. O corpo continua
explicando nomes, links, papéis e relações. `memoria_listar` resolve esses IDs
para títulos atuais, e `memoria_contextualizar` usa a sobreposição de entidades
para diferenciar, por exemplo, uma nova ideia de empresa de um Projeto existente.

## Fronteira de escrita

Somente a revisão humana chama `memoriaCriar` ou `memoriaAtualizar`. Os handlers
protegem path, ID imutável, campos gerenciados, schema, datas e estrutura do
corpo. Essa regra vale tanto para CLI quanto para interface web.

## Validações

- `npm run check:agents`: perfis, prompts, definições, allowlists e handlers;
- `npm run check:memory`: schema, IDs, preenchedor e estrutura;
- `npm run check:calls`: chunking, relatório e cobertura;
- `npm run check:curation`: revisão e aplicação web;
- `npm run typecheck`: contratos TypeScript;
- `npm run smoke:api`: diagnóstico explícito com chamadas reais.

O aplicativo `discordbot/` não é um agente. Ele grava e transcreve áudio,
entrega artefatos ao pipeline TypeScript e acompanha subprocessos com logs e DMs.
