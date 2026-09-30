# Documentação

Comece pelo [README principal](../README.md). Os guias descrevem a branch de
desenvolvimento; código, manifests e testes continuam sendo a referência para
modelos, parâmetros e comandos.

## Instalar e usar

| Guia | O que resolve |
| --- | --- |
| [Configuração](configuracao.md) | Dependências, credenciais, login e erros comuns |
| [Interface web](interface-web.md) | Chat, atlas, biblioteca e revisão |
| [Voz](voice-chat.md) | Microfone, síntese e fluxo por turnos |
| [Calls](calls.md) | Transcrição, análise, artefatos e curadoria |
| [Bot Discord](../discordbot/README.md) | Instalação Python e comandos de gravação |

## Entender a memória

| Guia | O que explica |
| --- | --- |
| [Busca Jev](jev-memory.md) | Triagem, navegação, leitura integral e resposta |
| [Estrutura](estrutura-memoria.md) | Pastas, metadados, seções e organização |
| [Seleção e escrita](memory-writing.md) | Evidências, contrato v2 e aprovação |
| [Modelos](../memory-template/index.md) | Como começar um acervo local vazio |

## Desenvolver

- [Visão do projeto](projeto.md): objetivos e componentes.
- [Arquitetura](arquitetura-agentes.md): responsabilidades e permissões.
- [Desenvolvimento](desenvolvimento.md): comandos e verificações por área.
- [Roadmap](roadmap.md): melhorias propostas, ainda não garantidas.
- [ADRs](adr/README.md): motivos das decisões duradouras.
- [Especificações](spec-driven-development.md): fluxo opcional para mudanças complexas.

Prompts em `src/agents/` são instruções executáveis dos agentes, não guias de uso.
Memórias reais, gravações e credenciais não pertencem à documentação.
