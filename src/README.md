# Código-fonte do assistente

Esta pasta contém a aplicação TypeScript. Prompts e definições de tools também
são fonte executável, por isso ficam co-localizados com o agente que os usa.
A interface Next.js não fica aqui: ela é um workspace separado em
`web_interface/` e importa este núcleo sem duplicá-lo.

## Dependências permitidas

```text
cli ─────► agents ─────► core
 │           │            │
 └──────────►tools ◄───────┘
```

- `core/` não conhece agentes específicos; executa perfis e function calls.
- `agents/` define contexto, modelo, tools permitidas e handoffs.
- `tools/` implementa operações locais compartilhadas.
- `cli/` orquestra interação humana; somente a revisão aprovada escreve memória.
- `dev/` contém diagnósticos executados manualmente.

## Agentes

Cada agente ocupa uma pasta completa:

```text
agents/<agente>/
  index.ts          montagem ou handoff específico
  instructions.md  system prompt
  tools/*.md        schemas e orientação das tools visíveis ao modelo
```

O registro central em `agents/registry.ts` escolhe modelo, limites e
permissões. A implementação de uma tool continua em `tools/` para poder ser
compartilhada sem duplicação.

Para trocar o modelo de um agente, altere somente o campo `model` do perfil em
`agents/registry.ts` e reinicie o processo em execução. CLI, interface web,
proveniência, cache do Analista e relatórios usam esse mesmo valor. O fallback
do cliente HTTP em `core/glm.ts` existe apenas para chamadas genéricas e nunca é
usado na construção de agentes.

Agentes atuais:

- `conversante/`: conversa e consulta memória;
- `analisador-call/`: interpreta transcrições multivoz e gera relatório com
  evidências;
- `curador-chat/`: transforma a conversa direta em candidatos;
- `curador-call/`: transforma o relatório do Analista em candidatos atribuídos
  e cobertura auditável.

A montagem final do Markdown não é feita pelo modelo. Os curadores enviam
deltas por seção e `tools/memoria/preencher.ts` produz o documento completo
segundo o contrato central de `tools/memoria/estrutura.ts`.
