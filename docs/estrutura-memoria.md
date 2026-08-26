# Estrutura da memória

> **Status:** estrutura implementada e migrada para schemas fixos no domínio
> `social/`.

## Objetivo

Definir (1) a árvore de pastas do bundle `memory/`, (2) os campos de
frontmatter de cada tipo de conceito, e (3) as convenções de nomeação/linkagem.
Seis tipos de conceito cobrem o escopo: **Pessoa, Grupo, Conhecimento, Evento,
Lugar e Projeto** — todos se linkam, formando um grafo pessoal
navegável.

---

## 1. Árvore de pastas

```
memory/
  index.md                    # índice raiz: visão geral do bundle
  social/
    index.md
    pessoas/
      index.md
      <slug>.md               # type: Pessoa
    grupos/
      index.md
      <slug>.md               # type: Grupo
  conhecimento/
    index.md
    programacao/              # area (1º nível)
      index.md
      backend/                # subarea (2º nível)
        index.md
        <slug>.md             # type: Conhecimento
      frontend/
        index.md
        <slug>.md
    teologia/
      index.md
      <slug>.md
    agronomia/
      ...
  eventos/
    index.md
    <slug>.md                 # type: Evento
  lugares/
    index.md
    <slug>.md                 # type: Lugar
  projetos/
    index.md
    <slug>.md                 # type: Projeto
```

Princípios:

- **Hierarquia livre** (o formato não dita a árvore). O path categoriza Conhecimento
  (`conhecimento/programacao/backend/...`).
- **Aninhamento com moderação** — até ~3 níveis sob cada domínio. Regras:
  não criar pasta com só 1 filho; `index.md` só em ramificações reais; lembre
  que `memoria_buscar` pula a hierarquia e acha a folha direto.
- **Slugs:** minúsculos, sem acento, `kebab-case` (`joao-silva.md`, `pedido-namoro-ana.md`).

---

## 2. Frontmatter de Pessoa

No bundle do Gudman, todas as chaves do schema são obrigatórias. Campos sem valor
usam `null`; listas vazias usam `[]`. `id`, `status` e `generated` são gerenciados
pelo handler, mas também estão sempre presentes no arquivo final. O `id` é
imutável e não depende de título, path ou tipo.

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Pessoa` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome de exibição ("João Silva") |
| `description` | sim | uma frase curta ou `null` |
| `categoria` | sim (aceita `null`) | `Familia` \| `Amigo` \| `Conhecido` |
| `vinculo` | sim (aceita `null`) | texto livre: descritor específico dentro da categoria |
| `apelido` | sim (aceita `null`) | string ou lista — como a pessoa é conhecida ("Zeta") |
| `data_nascimento` | sim (nosso) | data completa em ISO `YYYY-MM-DD`, ou `null` quando desconhecida; base canônica para calcular idade e aniversário |
| `proximidade` | sim (aceita `null`) | `0`–`5` (int) — contato/proximidade |
| `afinidade` | sim (aceita `null`) | `0`–`5` (int) — sintonia/interesses |
| `tags` | sim | lista; `[]` quando vazia |
| `status` | sim (injetado) | `stable` \| `draft` \| `deprecated` |
| `generated` | sim (injetado) | quem/quando produziu |

**`vinculo`** muda de sentido conforme a `categoria`: em `Familia` é o papel de
parentesco (`Primo`, `Tio`, `Irmao`...); em `Amigo`/`Conhecido` é o contexto de
origem (`Infancia`, `Trabalho`, `Faculdade`...). O grau de relação vai em
`proximidade`/`afinidade`.

**`proximidade` x `afinidade`:** dois eixos independentes, int 0–5 ou `null`.
Mãe pode ter `proximidade: 5 / afinidade: 4`; melhor amigo `proximidade: 4 /
afinidade: 5`.

**Filtros sociais controlados:** linguagem natural usa critérios fechados na
skill `memoria_buscar`, convertidos em código — não pelo julgamento livre do
modelo. `proxima` = proximidade ≥ 3; `muito_proxima`/`mais_proximas` = ≥ 4;
`distante` = ≤ 2; `boa_afinidade` = afinidade ≥ 3;
`muita_afinidade`/`mais_afinidade` = ≥ 4; `baixa_afinidade` = ≤ 2. Valores
`null` não entram em comparações. Limites numéricos diretos só são usados
quando o usuário informa uma nota explicitamente.

**`apelido`:** string, lista ou `null`. Como a pessoa é conhecida no grupo
("Zeta"). É buscável — `memoria_buscar consulta="Zeta"` acha a pessoa. O
`title` fica só com o nome canônico; você pode repetir o apelido no H1
(`# Bruno Sanches (Zeta)`) pra legibilidade humana.

**`data_nascimento` x idade:** guardar somente a data completa e explícita. A
idade não pertence ao bundle porque é derivada e ficaria obsoleta anualmente;
deve ser calculada em tempo de execução usando a data atual. Se a data for
desconhecida ou parcial, use `data_nascimento: null` — nunca valor vazio nem
uma data estimada. Aniversário recorrente também não vira um arquivo de Evento;
uma festa ou comemoração específica pode virar Evento normalmente.

### Exemplo

```markdown
---
type: Pessoa
id: mem_00000000-0000-4000-8000-000000000000
title: João Silva
apelido: null
description: Melhor amigo desde a infância, mora em São Paulo.
data_nascimento: 1994-09-17
categoria: Amigo
vinculo: Infancia
proximidade: 4
afinidade: 5
tags: [infancia, sp, design]
status: stable
generated: { by: human:alex, at: 2026-08-04 }
---

# João Silva

## Informações Gerais
Designer, mora em São Paulo e é amigo de infância de Alex.

## Princípios e Valores
Valoriza lealdade nas amizades e independência profissional.

## Características Físicas
Alto (~1,85), magro, cabelo castanho curto, barba rala. Óculos de armação preta.

## Personalidade
Extrovertido, bem-humorado, leal.

## Histórico
Nos conhecemos aos 7 anos. Moramos juntos em [Campinas](/lugares/campinas.md)
de 2016 a 2018.

## Interesses
Design, futebol, culinária italiana.

## Curiosidades

## Relações
### [Alex Moreira](/social/pessoas/alex-moreira.md)
- Considera Alex leal e intelectualmente curioso.
- Confia nele para conversas pessoais e valoriza sua franqueza.
```

---

## 3. Frontmatter de Conhecimento

Substitui a antiga "Preferencia". Cobre qualquer anotação por domínio —
programação, teologia, agronomia, etc. — classificada pela sua **natureza**
epistêmica.

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Conhecimento` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome curto ("Framework de frontend") |
| `description` | sim (aceita `null`) | em uma frase (vai pro índice) |
| `natureza` | sim (aceita `null`) | `Aprendizado` \| `Opiniao` \| `Hipotese` \| `Reflexao` |
| `tags` | sim | lista; `[]` quando vazia |
| `status` | sim (injetado) | `stable` \| `draft` (`draft` p/ Hipótese/Reflexão em fluxo) |
| `generated` | sim (injetado) | quem/quando |

**`natureza` — como o Gudman trata cada uma:**

- **`Aprendizado`** — conhecimento que você adquiriu/curou e quer trackear
  ("o que sei"). O assistente pode afirmar, mas não é pra virar enciclopédia
  genérica (o LLM já sabe que React é de 2013); vale quando é não-trivial ou
  específico do seu contexto.
- **`Opiniao`** — sua posição/preferência. O assistente atribui a você
  ("você prefere...").
- **`Hipotese`** — ideia tentativa, não comprometida. O assistente noticia
  como cogitação ("vêem que você considera...").
- **`Reflexao`** — insight/musings, não necessariamente uma posição. Oferece
  como perspectiva sua.

**Área = path:** a área/subárea do conhecimento fica **só no path**
(`conhecimento/programacao/backend/...`). O frontmatter **não duplica** isso —
o path já é a organização, e listar a pasta (`memoria_listar` num `index.md`) é
a forma mais barata de "ver tudo de backend". O frontmatter guarda só o que é
intrínseco ao conceito: `id`, `natureza`, `tags`, `status`, `generated`. Se um
conceito pertencer genuinamente a duas áreas, deixe-o na pasta primária e use
`tags` pra capturar a secundária.

### Exemplo — `conhecimento/programacao/frontend/framework-frontend.md`

```markdown
---
type: Conhecimento
id: mem_00000000-0000-4000-8000-000000000000
title: Framework de frontend
description: Prefere React como base, com margem para Next.js.
natureza: Opiniao
tags: [web, react, next]
generated: { by: human:alex, at: 2026-08-04 }
---

## Contexto
Frontend web em geral — SPAs, dashboards, sites com interatividade.

## Detalhes
Para frontend web, **prefiro React** como framework base. Componentização e
ecossistema pesam na escolha.

## Alternativas
**Next.js** quando faz sentido SSR/SSG, rotas ou SEO — é camada sobre React,
não troca. **Vue** só em projetos herdados.
```

### Exemplo — `conhecimento/agronomia/rotacao-culturas.md`

```markdown
---
type: Conhecimento
title: Rotação de culturas e fixação de nitrogênio
description: Leguminosas fixam N2 atmosférico via rizóbios, reduzindo N fertilizante.
natureza: Aprendizado
tags: [solo, nitrogenio]
generated: { by: human:alex, at: 2026-08-04 }
---

## Contexto
Anotado após ler sobre manejo do solo.

## Detalhes
Leguminosas (soja, feijão) hospedam bactérias do gênero *Rhizobium* em nódulos
radiculares; essas bactérias convertem N2 atmosférico em formas assimiláveis,
reduzindo a necessidade de fertilizantes nitrogenados naquela safra.
```

---

## 4. Frontmatter de Evento

Acontecimentos, marcos, encontros. O frontmatter mantém IDs estruturados para
identificação e busca; o corpo mantém nomes, links, papéis e explicações.

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Evento` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome do evento |
| `description` | sim (aceita `null`) | uma frase (vai pro índice) |
| `data` | sim (aceita `null`) | ISO datetime `YYYY-MM-DDTHH:mm` (hora local) |
| `datafim` | sim (aceita `null`) | ISO datetime; só pra eventos com duração |
| `tipo` | sim (aceita `null`) | enum aberto: `Festivo` \| `Periodo` \| `Acontecimento` \| `Encontro` \| ... |
| `participantes` | sim | IDs imutáveis de Pessoas/Grupos já cadastrados; `[]` quando vazio |
| `lugares` | sim | IDs imutáveis de Lugares já cadastrados; `[]` quando vazio |
| `tags` | sim | lista; `[]` quando vazia |
| `status` | sim (injetado) | `stable` \| `draft` |
| `generated` | sim (injetado) | quem/quando |

**`tipo` (enum aberto):** `Festivo` (aniversário, festa), `Periodo` (um intervalo da
vida — graduação, uma relação), `Acontecimento` (episódio pontual — pedido
de namoro, acidente), `Encontro` (encontro marcado — estudar, jantar). Novos
valores podem surgir; só manter consistente.

### Exemplo — `eventos/pedido-namoro-ana.md`

```markdown
---
type: Evento
id: mem_00000000-0000-4000-8000-000000000000
title: Pedido de namoro à Ana
description: Pedi a Ana em namoro no restaurante Y.
data: 2018-06-23T20:00
datafim: null
tipo: Acontecimento
participantes: [mem_11111111-1111-4111-8111-111111111111]
lugares: [mem_22222222-2222-4222-8222-222222222222]
tags: [ana, relacionamento]
generated: { by: human:alex, at: 2026-08-04 }
---

## Contexto
Jantar no restaurante Y, depois de 3 meses de namoro informal.

## Pessoas
- [Ana](/social/pessoas/ana.md)

## Lugar
- [Restaurante Y](/lugares/restaurante-y.md)
```

---

## 5. Frontmatter de Lugar

Cidades, endereços, regiões. O "quando morei lá" vai no corpo (um lugar serve
pra moradia, visita e evento sem acoplar ciclo de vida ao frontmatter).

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Lugar` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome ("Campinas") |
| `description` | sim (aceita `null`) | uma frase (vai pro índice) |
| `tipo` | sim (aceita `null`) | `Cidade` \| `Endereco` \| `Escola` \| `Regiao` \| `Pais` |
| `tags` | sim | lista; `[]` quando vazia |
| `status` | sim (injetado) | `stable` \| `deprecated` (p/ "onde parei de morar") |
| `generated` | sim (injetado) | quem/quando |

### Exemplo — `lugares/campinas.md`

```markdown
---
type: Lugar
id: mem_00000000-0000-4000-8000-000000000000
title: Campinas
description: Cidade onde morei durante a graduação (2016–2018).
tipo: Cidade
tags: [sp, moradia]
generated: { by: human:alex, at: 2026-08-04 }
---

## Moradia
Morei em Campinas de 2016 a 2018, durante a graduação. Bairro Taquaral.

## Visitas
Voltei em 2022 pra formatura de [João Silva](/social/pessoas/joao-silva.md).
```

---

## 6. Frontmatter de Grupo

Coletivos de pessoas — turmas de amigos, equipes, família, etc. O frontmatter
mantém IDs para recuperação; `## Membros` mantém links, nomes e papéis.

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Grupo` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome do grupo ("V3ga") |
| `description` | sim (aceita `null`) | uma frase (vai pro índice) |
| `tipo` | sim (aceita `null`) | `Amigos` \| `Trabalho` \| `Familia` \| `Estudo` \| ... |
| `membros` | sim | IDs imutáveis de Pessoas já cadastradas; `[]` quando vazio |
| `tags` | sim | lista; `[]` quando vazia |
| `status` | sim (injetado) | `stable` \| `draft` \| `deprecated` |
| `generated` | sim (injetado) | quem/quando |

### Exemplo — `social/grupos/v3ga.md`

```markdown
---
type: Grupo
id: mem_00000000-0000-4000-8000-000000000000
title: V3ga
description: Grupo de amigos.
tipo: Amigos
membros: []
tags: []
generated: { by: human:alex, at: 2026-08-04 }
---

# V3ga

## Sobre
Grupo de amigos.

## Membros
- [Bianca Duarte](/social/pessoas/bianca-duarte.md)
```

---

## 7. Frontmatter de Projeto

Projetos representam iniciativas com objetivo identificável, inclusive nas
fases de ideia e planejamento. Reuniões e marcos continuam sendo Eventos.

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | sim | fixo `Projeto` |
| `id` | sim (injetado) | `mem_<uuid>` estável e imutável |
| `title` | sim | nome da iniciativa |
| `description` | sim (aceita `null`) | uma frase curta |
| `estado` | sim (aceita `null`) | `Ideia` \| `Planejamento` \| `Ativo` \| `Pausado` \| `Concluido` \| `Cancelado` |
| `inicio` | sim (aceita `null`) | `YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm` |
| `fim` | sim (aceita `null`) | mesmo formato; `null` enquanto aberto/desconhecido |
| `participantes` | sim | IDs imutáveis de Pessoas/Grupos já cadastrados; `[]` quando vazio |
| `tags` | sim | lista; `[]` quando vazia |

---

## 8. Seções convencionais por tipo (corpo)

Headings `##` são um contrato estrutural, não sugestões livres. Todas as seções
do tipo são criadas na ordem canônica, mesmo vazias. Curadores enviam somente o
conteúdo e a seção de destino; o preenchedor determinístico monta o documento e
impede a introdução de seções desconhecidas.

**Pessoa (nesta ordem):** `## Informações Gerais` ·
`## Princípios e Valores` · `## Características Físicas` ·
`## Personalidade` · `## Histórico` · `## Interesses` ·
`## Curiosidades` · `## Relações`. `Relações` é sempre a última seção e usa
um bloco por alvo no formato `### [Nome](/social/pessoas/slug.md)`, seguido de
bullets. A perspectiva é direcional a partir da pessoa da ficha e registra
somente o modelo mental durável dela sobre o núcleo do alvo: caráter,
personalidade, valores, motivações percebidas, qualidades, defeitos e
sentimentos persistentes. Não entram parentesco, convivência, episódios,
logística, aptidão para tarefas nem papéis em projetos. Não atribua inferência
como declaração. Todas as seções são estruturais: as duas primeiras abrem a
ficha e `Relações` a encerra.

`Interesses` funciona como catálogo: uma linha por item no formato
`- **Interesse** detalhe curto.`. Não acumule episódios ou ocorrências; fatos
duráveis desse tipo pertencem a `Histórico` ou a um Evento.

**Conhecimento:** `## Contexto` · `## Detalhes` · `## Alternativas`

**Evento:** `## Contexto` · `## Pessoas` (com links) · `## Lugar` (com link) ·
`## Detalhes`. `Contexto` explica o episódio e sua relevância; `Pessoas` e
`Lugar` identificam entidades; `Detalhes` guarda desdobramentos.

**Lugar:** `## Moradia` (residentes e períodos) · `## Visitas` (passagens) ·
`## Notas` (características duráveis)

**Grupo:** `## Sobre` (identidade, origem e dinâmica) · `## Membros` (links e
papéis dos indivíduos) · `## Humor` (estilo de humor, piadas recorrentes, memes
e referências internas reconhecidas coletivamente)

**Projeto:** `## Visão Geral` · `## Estado Atual` · `## Participantes` ·
`## Decisões` · `## Próximos Passos` · `## Histórico`. Propostas em debate não
viram decisões, e papéis contextuais não viram características pessoais.

---

## 9. Convenções gerais

- **Slugs:** minúsculos, sem acento, `kebab-case`.
- **`title` em português**, com acento/maiúsculas normais.
- **Campos customizados** em português (`categoria`, `vinculo`,
  `data_nascimento`, `proximidade`, `afinidade`, `natureza`,
  `data`, `datafim`, `tipo`);
  **campos estruturais** em inglês (`id`, `type`, `title`, `description`, `tags`, `status`,
  `generated`).
- **`id` é identidade interna:** formato `mem_<uuid-v4>`, gerado somente pelo
  handler, globalmente único e preservado em atualização, renomeação ou mudança
  de título. Agentes não fornecem nem alteram esse campo.
- **Relações direcionais vão no body como subtítulos linkados**, com as
  percepções centrais em bullets abaixo. Para
  entidades cuja composição ajuda a identificar o conceito, o frontmatter
  mantém IDs imutáveis: `Grupo.membros`, `Projeto.participantes`,
  `Evento.participantes` e `Evento.lugares`. Nome, path e papel continuam no
  corpo; o ID serve a busca e sobrevive a renomeações.
- **Área de Conhecimento = path** (não há campo `area`/`subarea` no
  frontmatter). Filtrar por domínio = `memoria_listar` na pasta; filtrar por
  tipo = `memoria_buscar natureza:...`.
- **`index.md` em cada pasta de ramificação**, listando `title` + `description`
  dos filhos (progressive disclosure).
- **Datas em ISO:** eventos `YYYY-MM-DDTHH:mm` (hora local, sem fuso por enquanto).

---

## 10. Decisões

- **Troca de "Preferencia" por "Conhecimento"** com `natureza`
  (`Aprendizado`/`Opiniao`/`Hipotese`/`Reflexao`). ✅
- **Eventos:** `data` (datetime) + `datafim` (opc) + `tipo` (enum aberto). ✅
- **Eventos ↔ entidades:** IDs no frontmatter para recuperação e links no corpo
  para explicação humana. ✅
- **Lugares:** frontmatter mínimo, "quando morei" no corpo. ✅
- **`status: draft`** para Hipótese/Reflexão em fluxo; `deprecated` para lugares
  antigos. ✅
- **Área de Conhecimento = path só** (sem `area`/`subarea` no frontmatter);
  `natureza` classifica o tipo da nota. ✅
- **Identidade do autor:** `generated.by: human:<nome>`. ✅
- **`social/` dividido em `pessoas/` e `grupos/`** (grupos com `type: Grupo`). ✅
- **`apelido`** como campo opcional de Pessoa (string ou lista). ✅
- **Nascimento:** `data_nascimento` obrigatório em Pessoa (`YYYY-MM-DD` ou
  `null`); `idade` nunca é persistida, apenas derivada da data atual. ✅
- **Schema fixo:** todas as chaves do tipo são obrigatórias; desconhecido =
  `null`, lista vazia = `[]`, chave ausente = registro inválido. ✅
- **Identidade dos conceitos:** todo conceito tem `id: mem_<uuid-v4>` imutável,
  gerado pelo sistema; integrações referenciam o ID, nunca o título ou path. ✅
- **Domínio social:** caminho canônico `social/pessoas` e `social/grupos`;
  `categoria` continua no frontmatter, sem mover arquivos quando a relação
  muda. ✅

Estrutura implementada e migrada para schemas fixos no domínio `social/`. O
bundle de demonstração em `memory-seed/` ilustra todos os tipos; `npm run
memory:init` cria a cópia local editável.
