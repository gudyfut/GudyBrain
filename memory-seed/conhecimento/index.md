# Conhecimento

Conhecimento registra somente aprendizado, opinião, hipótese ou reflexão que
**o dono do bundle expôs deliberadamente como conhecimento próprio**.
Comentário casual ou conhecimento de outro participante não deve ser atribuído
ao dono. A **área** é a estrutura de pastas (`programacao/`,
`financas/`, ...), podendo ter subáreas (`programacao/frontend/`). Todos os
`.md` aqui usam o mesmo template (`type: Conhecimento`) — o template está
descrito abaixo, não se repete por subárea.

## Template: Conhecimento

### Frontmatter
- `type: Conhecimento`
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: tópico
- `description`: uma frase ou `null`
- `natureza`: `Aprendizado` | `Opiniao` | `Hipotese` | `Reflexao`; `null` se desconhecida
- `tags`: lista livre; use `[]` quando vazia
- (`id`/`status`/`generated` gerenciados pelo sistema; não inclua em propostas)

Todos os campos de conteúdo devem existir. Use `null` para valor desconhecido e `[]` para
lista vazia.

### Corpo
O corpo contém somente a memória final para leitura humana. Não inclua IDs
`fala_`/`obs_`, timestamps de citação nem referências ao processo de transcrição.

- `## Contexto` — origem, motivação, escopo e situações em que se aplica
- `## Detalhes` — conteúdo principal do aprendizado, opinião, hipótese ou reflexão
- `## Alternativas` — abordagens concorrentes, contrapontos ou opções comparadas

As três seções são estruturais e devem existir, mesmo quando vazias.

## Convenção
- A área/subárea fica **só no path** (não há campo `area` no frontmatter).
