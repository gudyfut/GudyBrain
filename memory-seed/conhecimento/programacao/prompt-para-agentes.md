---
type: Conhecimento
id: mem_1a2b3c4d-0000-4000-8000-000000000008
title: Prompts curtos com exemplos valem mais que instruções longas
description: Dar dois exemplos do resultado esperado costuma funcionar melhor que parágrafos de regras.
natureza: Aprendizado
tags: [ia, prompt]
status: draft
generated: { by: gudman/glm-5.1, at: 2026-08-20T10:00 }
---

## Contexto
- Observação própria ao construir agentes de IA para uso pessoal, incluindo os agentes deste projeto.
- Aplica-se quando o objetivo é obter saídas com formato previsível.

## Detalhes
- Instrução longa demais dilui o que importa; o modelo passa a escolher regras conflitantes.
- Dois ou três exemplos concretos do resultado esperado alinham formato, tom e nível de detalhe de uma vez.
- Regras que servem para prevenir erros raros podem virar validação automática em vez de texto no prompt.

## Alternativas
- Escrever schemas e validar a saída por código, tratando o prompt apenas como orientação geral.
- Manter instruções longas quando o formato é impossível de exemplificar.
