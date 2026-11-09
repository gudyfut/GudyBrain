# Execução

- [x] Conferir branch, protocolo oficial e fronteira de revisão humana.
- [x] Implementar adaptador de predicados e escolhas com validação estrita.
- [x] Migrar seleção, curadoria, configuração e interface.
- [x] Atualizar ADR e guias afetados.
- [x] Validar contratos, integração, regressões, navegador e build local.
- [x] Revisar e publicar na branch `codex/gpt-live`.

Validação: `npm test` com raiz fictícia; `npm run build` na raiz do checkout;
`npm run check:chat-ui`; `npm run check:voice-ui --workspace @gudybrain/web-interface`;
API de configurações e tela em desktop/mobile; `npm audit` sem vulnerabilidades;
101 links locais conferidos; `git diff --check`. Nenhuma inferência real foi chamada.

R1–R3: testes de contrato, recusas, cotas, erro de protocolo, cancelamento e timeout.
R2/R4: busca com adaptador padrão, curadoria com adaptadores HTTP simulados,
preservação de citações/abstenção/revisão-base e regressões de escrita.
R5/R6: modo atual e alias antigo, separação dos modelos/credenciais, interface
e testes de sessão de voz. Calibração e latência real permanecem fora da suíte.
