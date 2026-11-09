# 0005 — Seleção de memória pela Decisions API

**Estado:** Aceita

**Data:** 2026-11-09

## Contexto

O chat e o backend de GPT-Live usavam Jev/TypeSafe para julgar relevância de
memória. A curadoria também usava predicados e escolhas Jev para sustentação,
identidade, novidade, fidelidade e destino de propostas. O usuário solicitou
migrar essas responsabilidades para a Decisions API na mesma branch de voz.

## Decisão

Usar `POST /v1/decisions` com `gpt-6-luna`, único modelo suportado pelo contrato
consultado, e `GPT_API_KEY` exclusivamente no servidor. A chave também atende
GPT-Live. Não usar OAuth ChatGPT para Decisions. Responses mantém seu transporte
e `OPENAI_MODEL` independentes, conforme o ADR 0003.

Um adaptador converte os julgamentos em perguntas `predicate` e `choice`.
Validar nomes e cardinalidade das respostas, tipos, probabilidades, confiança,
opções e distribuição. Recusas e respostas inválidas interrompem o fluxo;
não são probabilidades zero. Não repetir chamadas automaticamente nem retornar
ao provedor antigo quando houver falha. Cancelamentos invalidam respostas tardias.

Preservar a orquestração local, os limiares conservadores existentes, a consulta
por identidade, os limites de leitura e as validações de evidência e escrita.
A migração não concede novas ações ao modelo. Propostas continuam exigindo
aprovação humana e revisão-base, conforme o ADR 0002.

`CHAT_MODE=decisions` passa a ser o padrão. `jev` continua aceito apenas como
alias de configuração para Decisions, facilitando a atualização de `.env`
existentes. Não há transporte TypeSafe nesta branch. A branch Gemini preserva
a implementação anterior. As decisões sobre voz e delegação local do ADR 0004
continuam válidas, com o provedor de seleção substituído por este ADR.

## Alternativas consideradas

- Trocar apenas o backend de voz: deixaria busca por texto e curadoria dependentes
  de Jev e produziria dois fluxos distintos para a mesma memória.
- Usar Responses para todos os julgamentos: geraria objetos de saída onde o
  contrato de predicados e escolhas da Decisions atende à seleção solicitada.
- Delegação Decisions nativa no GPT-Live: não reaproveita diretamente a árvore
  local, inspeção documental e curadoria compartilhadas com o chat de texto.

## Consequências

- Chat e curadoria passam a exigir créditos de API, além da autorização ChatGPT
  usada para inspeção e redação. A estimativa da voz continua sendo só da voz.
- Modelos, chaves e cotas de Decisions e Responses são independentes.
- Recusas podem impedir uma consulta ou a preparação de propostas; a aplicação
  informa a falha sem expor o conteúdo retornado pelo provedor.
- Limiares não são garantia de precisão. Sua calibração exige dados rotulados;
  testes simulados demonstram contratos e invariantes, não qualidade de inferência.

## Referências

- [Guia Decisions](https://developers.openai.com/api/docs/guides/decisions)
- [Contrato de criação](https://developers.openai.com/api/reference/resources/decisions/methods/create)
