# Execução

- [x] Conferir referências locais/remotas e preservar a branch Gemini.
- [x] Implementar criação WebRTC, controle no servidor e contratos do Live.
- [x] Integrar consultas, correções, histórico e bloqueio durante a voz.
- [x] Adaptar interface e remover o fluxo Gemini desta branch.
- [x] Criar testes locais e testar o navegador com fixtures.
- [x] Registrar ADR e atualizar guias de uso.
- [x] Concluir revisão, suíte completa, build, auditoria e links.
- [x] Conferir diff, commits e publicar as duas branches.

Avaliação auditiva com serviço real é uma etapa manual separada: não executada
pela suíte, para evitar consumo de créditos como teste de rotina.

Validação em 2026-11-09: `npm test` com raiz de dados fictícia, `npm run build`,
`npm run check:chat-ui`, `npm run check:voice-ui --workspace @gudybrain/web-interface`,
`npm audit` (zero vulnerabilidades), 66 links locais e `git diff --check`.
As rotas de produção também rejeitaram origem externa, ação inválida, sessão
inexistente e corpo excessivo; o endpoint Gemini removido respondeu 404.

Branches publicadas em `origin`: `codex/voice-gemini` preserva b434400;
`codex/gpt-live` contém a implementação. As referências `public`,
`codex/development` e `codex/testing` foram mantidas.
