# Decisions para seleção de memória

Estado: implementado e validado localmente. Data: 2026-11-09.

Substituir Jev/TypeSafe pela Decisions API na branch `codex/gpt-live`, dando
continuidade à [integração de voz](../2026-11-gpt-live/spec.md).

## Requisitos

- R1: usar `POST /v1/decisions`, modelo `gpt-6-luna` e `GPT_API_KEY` no servidor.
  Predicados e escolhas devem validar nomes, tipos, opções e probabilidades.
- R2: migrar busca de memória e curadoria de chat; retirar chamadas TypeSafe.
  Preservar inspeção e resposta pela Responses API com autenticação ChatGPT.
- R3: falhas, recusas e cancelamentos não equivalem a uma decisão negativa,
  não criam histórico incompleto nem liberam propostas sem evidência.
- R4: preservar leitura integral, caminhos permitidos, abstenção, citações,
  revisão concorrente e aprovação humana antes de escrever memória.
- R5: alinhar configuração, interface, diagnósticos e guias ao novo provedor.
  `CHAT_MODE=decisions` é o padrão; o valor antigo `jev` é alias de migração,
  sem executar o provedor antigo. Manter o modo GLM legado.
- R6: testes locais com respostas HTTP e memórias sintéticas, incluindo
  integração da seleção ao chat, curadoria e voz. Sem chamadas pagas de rotina.

## Limites

A voz Marin, as branches preservadas e os dados pessoais permanecem intactos.
Manter os limiares conservadores existentes; testes simulados validam contratos
e invariantes, não comprovam calibração probabilística ou latência em produção.
