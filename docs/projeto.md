# GudyBrain

GudyBrain é um assistente pessoal de IA com memória de longo prazo, desenvolvido
para manter contexto entre conversas sem depender apenas do histórico temporário
de um chat. O sistema combina agentes especializados, armazenamento estruturado
em Markdown, curadoria humana e processamento de conversas gravadas no Discord.

## Funcionalidades

- **Assistente com memória:** o Gudman consulta informações sobre pessoas,
  grupos, lugares, eventos, preferências e conhecimentos conforme a necessidade,
  sem carregar toda a base no contexto do modelo.
- **Memória portátil:** os dados são armazenados em arquivos Markdown com YAML
  frontmatter, IDs imutáveis e links entre registros, permitindo leitura humana,
  validação automática e versionamento.
- **Curadoria humana:** novas memórias são apresentadas como propostas antes da
  persistência. O usuário pode revisar diferenças, editar o conteúdo, aprovar ou
  rejeitar alterações.
- **Análise de chamadas:** conversas do Discord podem ser gravadas em trilhas
  separadas por participante, transcritas e organizadas em uma linha do tempo
  com identificação de autoria.
- **Extração assistida:** um agente analisa a conversa completa, identifica fatos,
  relações, acontecimentos e contexto relevante; outro agente transforma essas
  observações em propostas compatíveis com a estrutura da memória.
- **Interface unificada:** uma aplicação web local reúne chat, biblioteca de
  memórias, revisão de propostas, controle do bot e acompanhamento do fluxo de
  gravação, transcrição, análise e curadoria.

## Arquitetura

O núcleo utiliza uma arquitetura multiagente com responsabilidades e permissões
separadas:

1. O **agente conversante** interage com o usuário e consulta a memória.
2. O **analista de calls** interpreta transcrições e produz evidências atribuídas,
   sem permissão para alterar dados; uma busca determinística anexa possíveis
   correspondências com conceitos existentes.
3. O **curador de chat** converte a conversa direta em propostas estruturadas.
4. O **curador de call** trata observações multivoz, preserva atribuição e audita
   cobertura, contexto e novidade em relação à memória vigente.
5. Um **preenchedor determinístico** monta o Markdown sem permitir que o modelo
   improvise a estrutura dos arquivos.
6. A **camada de revisão humana** é a única autorizada a persistir alterações.

Essa separação reduz conflitos de contexto, limita ações indevidas do modelo e
mantém rastreável a origem das informações. O projeto é organizado como um
monorepo: núcleo e agentes em TypeScript, interface Next.js em workspace próprio
e bot do Discord como aplicação Python independente.

## Tecnologias

| Área | Tecnologias |
| --- | --- |
| Inteligência artificial | GLM via API da z.ai, agentes com tool calling e prompts especializados |
| Núcleo | TypeScript, Node.js, TSX e validação estrita com TypeScript |
| Interface | Next.js, React, Route Handlers, React Markdown e Lucide Icons |
| Memória | Markdown, YAML frontmatter, links e validações locais de esquema |
| Discord | Python, Pycord, PyNaCl e captura de áudio por participante |
| Transcrição | API Groq, Whisper Large V3, segmentação, cache e filtros de alucinação |
| Qualidade | Testes de contratos dos agentes, validações de memória, análise de calls e curadoria |

O resultado é um sistema local-first e extensível que transforma conversas em
conhecimento pessoal estruturado, mantendo o usuário no controle do que é
registrado permanentemente.
