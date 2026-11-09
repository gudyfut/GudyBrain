# Plano

1. Implementar adaptador Decisions com autenticação separada do OAuth, timeout,
   cancelamento e tratamento de recusas/erros sem expor payloads.
2. Renomear os contratos e módulos de seleção; conectar busca e curadoria ao
   adaptador, mantendo validações e revisão de escrita existentes.
3. Atualizar perfil, configuração local, interface, eventos e diagnóstico de voz.
4. Registrar ADR e corrigir guias operacionais afetados.
5. Testar protocolo HTTP, regressões de memória/voz, interface e build; revisar
   diff, confirmar ausência de chamadas TypeSafe e publicar na mesma branch.
