# Instruções para agentes de desenvolvimento

Este arquivo contém apenas acordos duradouros de trabalho. Não use estas
instruções como descrição do estado atual do produto: confirme comportamento,
modelos, rotas e comandos no código e nos manifests antes de alterá-los.

## Encontrar contexto

- Comece pelo pedido e pela menor área de código correspondente. `README.md`
  apresenta o produto; `package.json` e os manifests de cada workspace definem
  os scripts disponíveis. Use `rg` nesse escopo e amplie a busca somente quando
  importações ou referências levarem a outra área.
- `src/` contém o núcleo TypeScript; `web_interface/`, a aplicação web;
  `discordbot/`, a aplicação Python; `memory/`, dados pessoais. Leia guias em
  `docs/` apenas quando ajudarem na tarefa.
- Para entender o motivo de uma decisão arquitetural, consulte o índice em
  [docs/adr/](docs/adr/README.md) e somente os ADRs pertinentes. ADRs registram
  decisões no momento em que foram tomadas; confira o código atual antes de
  tratá-las como implementação vigente.
- Para uma mudança complexa ou ambígua, consulte o
  [fluxo opcional de especificações](docs/spec-driven-development.md).

## Limites

- Preserve alterações locais que não pertençam à tarefa. Confira o diff antes
  de concluir.
- `.env`, `memory/`, gravações, transcrições e caches podem conter dados
  sensíveis. Não os exponha nem inclua em commits ou exemplos. Acesse registros
  pessoais apenas quando o pedido exigir seu conteúdo.
- Antes de alterar persistência de memória ou aprovações, identifique no código
  a fronteira de revisão humana e mantenha as validações existentes.
- Não use chamadas reais a provedores nem conecte o bot como teste de rotina.
  Escolha verificações locais pelos scripts e testes da área modificada.

## Entrega e documentação

Valide conforme o escopo; para documentação, confira links alterados e rode
`git diff --check`. Descreva o que mudou, a validação executada e limitações.

Não atualize documentação a cada edição de código apenas para repetir a
implementação. Crie ou revise um ADR quando a tarefa **estabelecer, substituir
ou revogar uma decisão arquitetural duradoura**; atualize um guia apenas quando
o próprio guia passar a orientar incorretamente seu uso. Consulte
[as regras de ADR](docs/adr/README.md) para registrar o contexto e a decisão.
