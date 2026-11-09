# Plano

- Preservar a base Gemini em branch própria e usar o checkout atual para Live.
- Separar controlador testável, transporte OpenAI e integração com sessões do
  chat. Usar um sideband no servidor, com a sessão WebRTC criada pela API Live.
- Criar uma instância do agente por consulta e descartar resultados cancelados.
  Só incorporar legendas do sideband ao histórico que a curadoria consulta.
- Adaptar o chat para chamada contínua, mute, áudio bloqueado, consumo e fim.
- Retirar o caminho Gemini da branch Live, mantendo-o na branch preservada.
- Registrar a fronteira no ADR 0004. Atualizar configuração e guias de voz.
- Validar R1–R7 com fixtures e testes de ciclo de vida; R1/R4/R5/R6 com navegador
  simulado; executar tipos, suíte, build, auditoria, links e diff para R8.
