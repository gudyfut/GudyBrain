# Template: Projeto

Um Projeto é uma **iniciativa com objetivo identificável**, desde uma ideia
compartilhada até uma execução concluída. Uma conversa, reunião ou marco do
projeto pertence a Evento e pode ser linkado no Histórico. Frontmatter
`type: Projeto`.

## Frontmatter
- `type: Projeto`
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: nome da iniciativa
- `description`: uma frase curta ou `null`
- `estado`: `Ideia` | `Planejamento` | `Ativo` | `Pausado` | `Concluido` |
  `Cancelado`; `null` se desconhecido
- `inicio`: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm` ou `null`
- `fim`: mesmo formato; `null` quando desconhecido ou ainda não encerrado
- `participantes`: IDs imutáveis `mem_<uuid>` de Pessoas ou Grupos envolvidos;
  use `[]` quando ainda não houver participante identificável
- `tags`: lista livre; use `[]` quando vazia
- (`id`, `status` e `generated` são gerenciados pelo sistema)

Todos os campos de conteúdo devem existir. Use `null` para valor desconhecido e
`[]` para lista vazia.

## Corpo

- `## Visão Geral` — objetivo, problema, escopo e resultado pretendido
- `## Estado Atual` — situação presente, fase, bloqueios e pontos indefinidos
- `## Participantes` — nomes, links, organizações externas e papéis humanos. O
  frontmatter identifica entidades internas por ID; esta seção explica como
  participam
- `## Decisões` — acordos efetivos; propostas não decididas devem ser rotuladas
  explicitamente como propostas e ficar na seção seguinte
- `## Propostas e Questões em Aberto` — alternativas ainda em discussão, hipóteses,
  pendências e dúvidas, com autoria quando conhecida
- `## Próximos Passos` — somente ações futuras explicitamente combinadas
- `## Histórico` — origem, mudanças e marcos, com links para Eventos

As sete seções são estruturais e devem existir, mesmo quando vazias. Não use
Projeto como depósito de características pessoais: competência, papel ou
comportamento discutido apenas no contexto da iniciativa permanece aqui.
