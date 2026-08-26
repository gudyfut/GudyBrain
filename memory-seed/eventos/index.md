# Template: Evento

Um Evento é algo **situado no tempo**. Use `Periodo` para uma configuração
sustentada, `Acontecimento` para um episódio delimitado e `Encontro` para uma
ocasião interpessoal relevante. Não use Evento para descrever permanentemente
uma Pessoa, Grupo ou Lugar. Frontmatter `type: Evento`.

## Frontmatter
- `type: Evento`
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: nome do evento
- `description`: uma frase ou `null`
- `data`: ISO datetime `YYYY-MM-DDTHH:mm` (hora local) ou `null`
- `datafim`: mesmo formato para faixas; `null` quando não houver
- `tipo`: `Periodo` | `Acontecimento` | `Encontro` | `Festivo` | ...; `null` se desconhecido
- `participantes`: IDs imutáveis `mem_<uuid>` das Pessoas ou Grupos envolvidos
- `lugares`: IDs imutáveis `mem_<uuid>` dos Lugares cadastrados associados
- `tags`: lista livre; use `[]` quando vazia
- (`id`/`status`/`generated` gerenciados pelo sistema; não inclua em propostas)

Todos os campos de conteúdo devem existir. Use `null` para valor desconhecido e `[]` para
lista vazia.

## Corpo
O corpo contém somente a memória final para leitura humana. Não inclua IDs
`fala_`/`obs_`, timestamps de citação nem referências ao processo de transcrição.

- `## Contexto` — o que ocorreu, quando aproximadamente, antecedentes e relevância
- `## Pessoas` — participantes e papéis, com links para `/social/pessoas/slug.md`
- `## Lugar` — local ou locais associados, com links para `/lugares/slug.md`
- `## Detalhes` — desdobramentos e fatos importantes que não cabem acima

As quatro seções são estruturais e devem existir, mesmo quando vazias.
