# Agentes

Cada subpasta contém um agente completo: código de montagem, system prompt e
definições das ferramentas que o modelo pode enxergar.

- `conversante/`: Gudman; mantém o histórico e consulta a memória.
- `analisador-call/`: interpreta transcrições multivoz, avalia o contexto global
  e produz observações e recomendação atribuídas em JSON/Markdown, sem preparar
  candidatos.
- `curador-chat/`: recebe somente a conversa direta e prepara deltas de memória.
- `curador-call/`: recebe somente o relatório do Analista de call, prepara
  deltas atribuídos e audita a cobertura das observações.
- `curadoria/`: contexto estrutural compartilhado; não é um agente.
- `registry.ts`: fonte canônica de modelos, limites, caminhos e permissões.

Trocar `model` em um perfil e reiniciar a aplicação é suficiente. A fábrica
obriga todo agente a receber esse valor; a interface e os caches consultam o
mesmo registro. A variável `GLM_MODEL` do `.env` sobrescreve apenas o perfil do
conversante; curadores e analista sempre usam o modelo do próprio perfil.

As implementações locais das ferramentas ficam em `src/tools/`. O agente só
consegue chamar uma ferramenta quando ela está simultaneamente definida em sua
pasta, permitida no registro e implementada no registro de handlers.

Os curadores não redigem o documento Markdown completo. A tool
`memoria_preparar_candidato` recebe campos e conteúdos destinados a seções
canônicas; `src/tools/memoria/preencher.ts` preserva o arquivo atual e monta a
proposta completa segundo `estrutura.ts`.

Ao modificar um agente, execute:

```powershell
npm run check:agents
npm run typecheck
```
