# 0001 — Contexto sob demanda para agentes

**Estado:** Aceita

**Data:** 2026-09-29

## Contexto

O projeto muda com frequência. Mapas extensos de arquivos, provedores, comandos
e fluxos dentro de `AGENTS.md` duplicam fontes executáveis, envelhecem rápido e
são carregados mesmo quando a tarefa não precisa deles.

## Decisão

Manter `AGENTS.md` curto, com orientação de descoberta e limites de trabalho.
Obter o estado atual do código, dos manifests e dos testes relevantes. Registrar
em ADRs separados apenas decisões arquiteturais que precisem de justificativa
duradoura. Consultar o índice de ADRs e abrir somente os registros pertinentes.
Usar especificações para mudanças complexas ou ambíguas, sem exigir artefatos
para trabalho rotineiro.

## Consequências

- Menos contexto é carregado automaticamente; a exploração localizada passa a
  fazer parte de cada tarefa.
- Um ADR explica a decisão histórica, mas não prova que a implementação ainda a
  segue. Mudanças posteriores devem substituí-lo explicitamente quando
  revogarem a decisão.
