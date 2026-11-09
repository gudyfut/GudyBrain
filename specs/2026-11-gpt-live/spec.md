# Conversa contínua com GPT-Live

Estado: implementado e validado localmente. Data: 2026-11-09.

## Objetivo e escopo

Preservar a implementação Gemini em `codex/voice-gemini` e desenvolver a voz
GPT-Live em `codex/gpt-live`, a partir da base atualizada b434400. Não reescrever
`public`, `codex/development` ou `codex/testing`.

## Requisitos e aceite

- R1: usar `GPT_API_KEY` somente no servidor; sessão `gpt-live-1`, WebRTC,
  voz brasileira e entrada/saída contínuas com transcrições na interface.
- R2: delegar consultas a Jev/Gudman; manter autenticação e revisão de memória.
  A voz não pode salvar memória nem aprovar propostas.
- R3: obter o pedido das transcrições e do contexto local; eventos de delegação
  só contêm metadados. Correções e encerramento descartam resultados atrasados.
- R4: manter falas transcritas separadas de rascunhos do backend e integrá-las
  ao histórico após encerrar. Bloquear texto/curadoria durante a chamada.
- R5: tratar fim voluntário, navegação, cancelamento na conexão, permissão,
  autoplay, rede, cota e erros do provedor sem deixar o microfone ativo.
- R6: limitar duração e inatividade, mostrar consumo estimado e distinguir uso
  final confirmado de desconexão sem confirmação. Não reconectar automaticamente.
- R7: preservar acesso local, validar tamanho e ação nas rotas e não expor
  chaves, raciocínio interno ou eventos de execução pelo canal do navegador.
- R8: validar localmente com dados sintéticos e atualizar os guias afetados.

## Restrições

Não ler acervos pessoais nem usar chamadas reais como teste de rotina. Histórico
em RAM; sem persistência de áudio. Qualidade auditiva e latência real não podem
ser inferidas dos testes simulados e exigem avaliação manual separada.
