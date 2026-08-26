# Template: Grupo

Um Grupo é um **coletivo reconhecível e relativamente estável**: turma, equipe,
família ou círculo de amigos. Uma reunião pontual ou combinação ocasional de
pessoas é Evento, não Grupo. Frontmatter `type: Grupo`.

## Frontmatter
- `type: Grupo`
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: nome do grupo ("V3ga")
- `description`: uma frase ou `null`
- `tipo`: `Amigos` | `Trabalho` | `Familia` | `Estudo` | ...; `null` se desconhecido
- `membros`: IDs imutáveis `mem_<uuid>` das Pessoas cadastradas que compõem o
  grupo; use `[]` quando desconhecidos
- `tags`: lista livre; use `[]` quando vazia
- (`id`/`status`/`generated` gerenciados pelo sistema; não inclua em propostas)

Todos os campos de conteúdo devem existir. Use `null` para valor desconhecido e `[]` para
lista vazia.

## Corpo
O corpo contém somente a memória final para leitura humana. Não inclua IDs
`fala_`/`obs_`, timestamps de citação nem referências ao processo de transcrição.

- `## Sobre` — identidade, origem, propósito, história e dinâmica geral do grupo
- `## Membros` — pessoas que compõem ou compuseram o grupo, com links para
  `/social/pessoas/slug.md` e papéis relevantes quando conhecidos
- `## Humor` — estilo de humor coletivo, piadas recorrentes, memes e referências
  internas reconhecidas por mais de um membro. Uma brincadeira isolada não deve
  ser transformada em característica do grupo

As três seções são estruturais e devem existir, mesmo quando vazias.
