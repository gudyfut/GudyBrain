# Template: Lugar

Um Lugar é um **local físico ou geográfico identificável e reutilizável**, como
cidade, escola, casa, região ou estabelecimento. Uma visita ou episódio que
ocorreu ali pertence a Evento e pode ser linkado. Frontmatter `type: Lugar`.

## Frontmatter
- `type: Lugar`
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: nome
- `description`: uma frase ou `null`
- `tipo`: `Cidade` | `Regiao` | `Pais` | `Escola` | `Casa` | ...; `null` se desconhecido
- `tags`: lista livre; use `[]` quando vazia
- (`id`/`status`/`generated` gerenciados pelo sistema; não inclua em propostas)

Todos os campos de conteúdo devem existir. Use `null` para valor desconhecido e `[]` para
lista vazia.

## Corpo
O corpo contém somente a memória final para leitura humana. Não inclua IDs
`fala_`/`obs_`, timestamps de citação nem referências ao processo de transcrição.

- `## Moradia` — quem morou ou mora no local e em quais períodos
- `## Visitas` — passagens recorrentes ou relevantes; episódios marcantes podem
  apontar para Eventos
- `## Notas` — características duráveis, localização, função e contexto geral

As três seções são estruturais e devem existir, mesmo quando vazias.
