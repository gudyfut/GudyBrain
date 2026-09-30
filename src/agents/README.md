# Agentes

As pastas de agentes reúnem a montagem e os prompts de cada etapa. Os agentes
GLM com tool-calling também têm definições em `tools/`; os perfis Jev/GPT pela Responses API do
chat não expõem ferramentas ao modelo.

- `conversante/`: conversa GLM legada e orquestração Jev/GPT pela Responses API padrão, incluindo
  inspeção estruturada e resposta com memória.
- `recuperador-jev/`: triagem e seleção progressiva de memória no chat padrão.
- `analisador-call/`: interpreta transcrições multivoz, avalia o contexto global
  e produz observações e recomendação atribuídas em JSON/Markdown, sem preparar
  candidatos.
- `curador-chat/`: recebe somente a conversa direta e prepara deltas de memória.
- `curador-call/`: recebe somente o relatório do Analista de call, prepara
  deltas atribuídos e audita a cobertura das observações.
- `curadoria/`: contexto estrutural compartilhado; não é um agente.
- `registry.ts`: fonte canônica de modelos, limites, caminhos e permissões.

`registry.ts` define os modelos e limites por perfil; não há `GLM_MODEL` global.
Confirme a configuração e o transporte da etapa antes de trocar um modelo.

As implementações locais das ferramentas ficam em `src/tools/`. Para agentes
com tool-calling, a ferramenta precisa estar definida na pasta do agente,
permitida no perfil e implementada no registro de handlers.

Os curadores não redigem o documento Markdown completo. O curador de call envia
campos e itens por seção via `memoria_preparar_candidato`; a curadoria de chat
usa o compilador local do mesmo contrato tipado. O
`src/tools/memoria/preencher.ts` preserva o arquivo atual e monta a proposta
segundo `estrutura.ts`.

Ao modificar um agente, execute:

```powershell
npm run check:agents
npm run typecheck
```
