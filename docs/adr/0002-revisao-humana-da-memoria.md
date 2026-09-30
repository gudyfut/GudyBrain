# 0002 — Revisão humana antes da escrita de memória

**Estado:** Aceita

**Data:** 2026-09-29

## Contexto

O sistema produz candidatos de memória a partir de conversa e calls. Essas
inferências podem estar incompletas, atribuídas incorretamente ou entrar em
conflito com registros pessoais existentes.

## Decisão

Separar a preparação de candidatos da persistência. A aplicação de uma
proposta exige uma decisão humana de revisão e passa por validações estruturais
e de conflito de versão no momento da escrita.

## Consequências

- A memória não é alterada automaticamente ao fim de uma análise ou conversa.
- Uma proposta pode exigir nova revisão se o registro de base tiver mudado.
- A revisão adiciona uma etapa manual ao fluxo. Alterar essa fronteira requer
  uma nova decisão arquitetural explícita.
