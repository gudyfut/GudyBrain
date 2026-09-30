# Estrutura da memória

Um acervo é uma pasta local `memory/` com arquivos Markdown, frontmatter YAML
e links entre conceitos. Os seis tipos atuais são Pessoa, Grupo, Projeto,
Evento, Lugar e Conhecimento. O contrato canônico fica em
[`estrutura.ts`](../src/tools/memoria/estrutura.ts); os validadores ficam em
[`schema.ts`](../src/tools/memoria/schema.ts).

## Pastas e agrupamentos

```text
memory/
  index.md
  social/
    index.md
    pessoas/
      index.md
      equipe/
        index.md
        pessoa-exemplo.md
    grupos/
      index.md
  projetos/
    index.md
  eventos/
    index.md
  lugares/
    index.md
  conhecimento/                 # opcional
    index.md
```

Esta árvore é ilustrativa. Use [os modelos](../memory-template/index.md) para
começar. Crie subpastas quando houver grupos reconhecíveis de documentos e
escreva um `index.md` curto explicando o escopo de cada ramificação. Uma boa
descrição ajuda Jev a escolher a pasta sem receber todos os arquivos.

A recuperação descobre a árvore existente; os nomes das subcategorias são
livres. A **escrita**, porém, exige que cada tipo permaneça em sua pasta:
Pessoa em `social/pessoas/`, Grupo em `social/grupos/`, Projeto em `projetos/`,
Evento em `eventos/`, Lugar em `lugares/` e Conhecimento em `conhecimento/`.

Mover fichas manualmente exige corrigir os links Markdown. Preserve os IDs.
Criar outro tipo, campo ou seção exige alterar contrato, modelos e validadores;
editar somente um `index.md` não estende o schema do sistema.

## Frontmatter

Todo conceito tem `type`, `title`, `description` e `tags`, mais os campos abaixo.
Todas as chaves do tipo devem existir: desconhecido é `null`; lista vazia é `[]`.
Campos extras não são aceitos pela interface de escrita.

| Tipo | Campos adicionais |
| --- | --- |
| Pessoa | `apelido`, `data_nascimento`, `categoria`, `vinculo`, `proximidade`, `afinidade` |
| Grupo | `tipo`, `membros` |
| Projeto | `estado`, `inicio`, `fim`, `participantes` |
| Evento | `data`, `datafim`, `tipo`, `participantes`, `lugares` |
| Lugar | `tipo` |
| Conhecimento | `natureza` |

O documento persistido também contém `id`, `status` e `generated`, gerenciados
pelo sistema. Curadores não fornecem esses três campos. O ID é globalmente único,
no formato `mem_<uuid-v4>`, e não muda ao renomear a ficha.

- **Pessoa:** `categoria` aceita Familia, Amigo, Conhecido ou `null`;
  `proximidade` e `afinidade` são inteiros de 0 a 5 ou `null`. São eixos distintos.
  `apelido` e `vinculo` aceitam texto, lista de textos ou `null`.
- **Nascimento:** data completa `YYYY-MM-DD` ou `null`. Não persista idade nem
  estime a data a partir de uma informação parcial.
- **Projeto:** `estado` aceita Ideia, Planejamento, Ativo, Pausado, Concluido,
  Cancelado ou `null`. `inicio`/`fim`: `YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm`.
- **Evento:** `data`/`datafim` usam `YYYY-MM-DDTHH:mm` quando conhecidas.
  Use tipos consistentes, como Periodo, Acontecimento ou Encontro.
- **Conhecimento:** `natureza` distingue Aprendizado, Opiniao, Hipotese e Reflexao.
  O domínio fica no caminho, sem campos `area`/`subarea`.
- **Referências:** `membros` usa IDs de Pessoas; `participantes` usa IDs de
  Pessoas/Grupos; `lugares` usa IDs de Lugares. Referencie registros existentes.

## Seções do corpo

As seções `##` são criadas na ordem do contrato, mesmo vazias:

| Tipo | Ordem das seções |
| --- | --- |
| Pessoa | Informações Gerais; Princípios e Valores; Características Físicas; Personalidade; Histórico; Interesses; Curiosidades; Relações |
| Grupo | Sobre; Membros; Dinâmica; Humor; Acordos |
| Projeto | Visão Geral; Estado Atual; Participantes; Decisões; Propostas e Questões em Aberto; Próximos Passos; Histórico |
| Evento | Contexto; Pessoas; Lugar; Detalhes |
| Lugar | Moradia; Visitas; Notas |
| Conhecimento | Contexto; Detalhes; Alternativas |

Separe os assuntos pela função: traço durável em Pessoa, padrão coletivo em
Grupo, iniciativa em Projeto e episódio situado no tempo em Evento. Uma proposta
em discussão não vira decisão; uma piada isolada não vira característica.

Em Pessoa, **Interesses** usa `- **Interesse** detalhe curto.`. **Relações**
fica por último e guarda percepções duráveis da pessoa sobre outra pessoa,
com um bloco `### [Nome](/social/pessoas/slug.md)` seguido de bullets.
Parentesco, convivência, episódios e papéis em projetos pertencem às demais
seções, não a Relações.

## Exemplo completo, sem dados pessoais

Abaixo, um Grupo com todas as chaves e seções. O ID e a autoria são ilustrativos;
na curadoria, o sistema os gera. Não reutilize este ID em vários documentos.

```markdown
---
type: Grupo
id: mem_00000000-0000-4000-8000-000000000000
title: Equipe Exemplo
description: Equipe fictícia usada para demonstrar a estrutura.
tipo: Trabalho
membros: []
tags: []
status: stable
generated: { by: "human:exemplo", at: "2026-09-30" }
---

# Equipe Exemplo

## Sobre
- Equipe fictícia usada como exemplo.

## Membros

## Dinâmica

## Humor

## Acordos
```

Use slugs em minúsculas, sem acentos, separados por hífen. O `title` conserva
a grafia de exibição. Links no corpo são relativos à raiz do acervo, como
`/projetos/exemplo.md`; IDs no frontmatter mantêm a identidade entre renomeações.

## Validar

`npm run check:memory` verifica o acervo local, quando existir, e os contratos.
Para propostas, revisão e persistência, veja [seleção e escrita](memory-writing.md).
Para limites da recuperação, veja [busca Jev](jev-memory.md).
