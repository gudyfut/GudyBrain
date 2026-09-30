# Núcleo TypeScript

A interface web importa este núcleo. Prompts e definições de ferramentas ficam
junto dos agentes porque são parte de sua configuração executável.

## Organização

| Pasta | Responsabilidade |
| --- | --- |
| `core/` | Runtime, provedores GLM/Jev/Responses, OAuth, ambiente e eventos |
| `agents/` | Etapas especializadas, perfis e orquestração |
| `tools/` | Operações locais e contratos compartilhados de memória |
| `dev/` | Validações e diagnósticos, fora do fluxo do produto |

O servidor web orquestra a interação humana e chama agentes/ferramentas.
Componentes de navegador não devem importar leitores de memória ou credenciais.

## Configurar agentes

[`agents/registry.ts`](agents/registry.ts) define perfis, valores padrão,
limites, prompts e ferramentas permitidas. Os modelos do chat também respeitam
`OPENAI_MODEL` e `JEV_MODEL`; os perfis GLM definem seus próprios modelos.
Não basta alterar um único perfil para configurar todos os provedores.

Agentes com ferramentas precisam de definição em `tools/*.md`, permissão no
perfil e handler em `tools/registry.ts`. O chat Jev/GPT usa pedidos estruturados
validados pelo código, sem expor essas ferramentas aos modelos.

O [índice dos agentes](agents/README.md) mostra as etapas.
O contrato de escrita está em `tools/memoria/estrutura.ts` e
`contrato-escrita.ts`; `preencher.ts` compila itens em Markdown.
Só uma ação humana validada persiste propostas/edições.

Consulte [arquitetura](../docs/arquitetura-agentes.md) para as fronteiras e
[desenvolvimento](../docs/desenvolvimento.md) para os comandos de validação.
