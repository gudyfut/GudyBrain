# 0004 — GPT-Live com delegação para o agente local

**Estado:** Aceita

**Data:** 2026-11-09

Evolução: o [ADR 0005](0005-selecao-memoria-via-decisions.md) substitui Jev por
Decisions na seleção delegada. As decisões de voz, histórico e revisão abaixo
continuam em vigor.

## Contexto

A voz anterior encadeava transcrição Gemini, revisão do texto, consulta de
memória e síntese Gemini. Conversação contínua exige áudio bidirecional,
interrupções e trabalho de memória independente da fala. O fluxo de revisão
humana da memória e a autenticação ChatGPT do agente já existem.

## Decisão

Na branch `codex/gpt-live`, usar `gpt-live-1` com WebRTC para áudio e
`delegation.type=client`. O servidor cria a sessão com `GPT_API_KEY` e conecta
um WebSocket de controle antes de entregar a resposta SDP ao navegador.
O navegador pode apenas encerrar a sessão pelo canal de dados; consultas,
instruções e resultados são controlados pelo servidor.

O agente Jev/Gudman existente atende consultas somente de leitura, com seu
próprio contexto e autenticação Responses via ChatGPT. Uma consulta usa uma
instância independente, para que cancelamentos e respostas ainda não faladas
não sejam confundidos com histórico da conversa. Correções cancelam a consulta
anterior e descartam resultados atrasados.

Transcrições recebidas do provedor são mantidas em RAM e incorporadas ao chat
ao encerrar a voz. Não são prova de reprodução completa do áudio. Texto e
curadoria ficam bloqueados nessa sessão enquanto a voz estiver aberta. O botão
Memorizar continua preparando propostas para revisão humana (ADR 0002).

Sessões usam `store: false`, encerramento explícito, limite de duração e
inatividade com atividade de áudio. O consumo só é marcado como confirmado
quando chega `session.closed` com uso válido. Não há reconexão automática que
crie uma nova sessão cobrada. A implementação Gemini permanece preservada em
`codex/voice-gemini`.

## Alternativas consideradas

- Trocar somente transcrição e TTS: preserva turnos manuais, sem atender à
  conversa contínua solicitada.
- Delegação Responses gerenciada pelo Live: não reaproveita diretamente o
  controle local de seleção, inspeção de documentos e autenticação existente.
- Executar delegações no navegador: dispersa a responsabilidade pelo histórico
  e pelas consultas, além de ampliar as permissões do cliente.

## Consequências

- A voz consome créditos de API por duração, inclusive silêncio. Jev e o
  backend continuam com suas contas e limites próprios (ADR 0003).
- O servidor exige um processo Node persistente; não é um endpoint serverless.
- O protocolo não fornece turnos completos de transcrição. Agrupamento,
  correções e limites de contexto são responsabilidade da aplicação.
- Reiniciar o servidor perde o histórico em RAM. Nenhum áudio é salvo pelo app.
- Testes locais cobrem contratos e ciclo de vida. Pronúncia, latência e
  interrupções audíveis exigem avaliação real separada, com consumo de créditos.

## Referências

- [GPT-Live](https://developers.openai.com/api/docs/guides/live)
- [Delegação](https://developers.openai.com/api/docs/guides/live-delegation)
- [Controle no servidor](https://developers.openai.com/api/docs/guides/voice-server-controls)
- [Sessões e consumo](https://developers.openai.com/api/docs/guides/live-conversations)
