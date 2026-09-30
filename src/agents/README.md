# Agentes e etapas

| Área | Responsabilidade |
| --- | --- |
| `conversante/` | Orquestração Jev/GPT, inspeção e resposta; conversante GLM legado |
| `recuperador-jev/` | Triagem e navegação progressiva da memória |
| `curador-chat/` | Extração GPT, julgamento Jev e preparação de itens/candidatos |
| `analisador-call/` | Contexto e observações atribuídas da transcrição |
| `curador-call/` | Novidade, deltas e cobertura do relatório de call |
| `curadoria/` | Contexto compartilhado; não é um agente |

`registry.ts` declara perfis e padrões. `pipeline.ts` descreve entradas,
saídas e proibições entre etapas. O chat respeita `OPENAI_MODEL`/`JEV_MODEL`;
GLM é definido por perfil, sem variável global `GLM_MODEL`.

## Prompts e ferramentas

Cada etapa mantém sua montagem e prompts no próprio diretório. Agentes GLM
com tool-calling também mantêm definições em `tools/`. Uma ferramenta precisa
estar permitida no perfil e implementada em `src/tools/registry.ts`.

Jev julga opções; GPT recebe instruções/contexto e pode pedir leituras em saída
estruturada. Nenhum deles tem ferramentas de sistema no fluxo padrão do chat.
Curadores não entregam Markdown integral nem persistem arquivos: o compilador
local aplica o contrato tipado e a revisão humana decide a escrita.

Ao modificar perfis/prompts, execute `npm run check:agents` e
`npm run typecheck`. Para testes de cada fluxo, consulte
[desenvolvimento](../../docs/desenvolvimento.md).
