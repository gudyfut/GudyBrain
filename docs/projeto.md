# Visão do projeto

O GudyBrain mantém contexto útil entre conversas por meio de um acervo local
de memória. O foco é auxiliar pessoas, grupos e suas iniciativas, preservando
autoria e revisão humana do que será registrado.

## Componentes atuais

| Componente | Papel |
| --- | --- |
| Gudman | Conversa por texto/voz com recuperação de memória |
| Jev | Triagem, navegação e julgamento de candidatos no chat |
| Responses API | Inspeção de documentos, extração/redação e resposta GPT |
| Memória Markdown | Conceitos com metadados, IDs, seções e links |
| Curadoria | Propostas com evidências e escrita contratual |
| Interface Next.js | Atlas, biblioteca, aprovação, calls e configurações |
| Bot Python | Captura por participante e transcrição Groq |
| Agentes GLM | Análise e curadoria de calls; chat legado |

## Princípios

- A memória profunda não é alterada automaticamente pelos modelos.
- O código monta e valida documentos; o modelo propõe dados delimitados.
- Recuperação e curadoria têm responsabilidades e contextos distintos.
- IDs preservam identidade; títulos e caminhos podem mudar.
- Código e modelos são públicos; dados pessoais e credenciais ficam locais.

“Local” descreve execução e armazenamento: contexto necessário ainda é enviado
aos provedores de IA. Não é um assistente que funciona inteiramente offline.

## Ler em seguida

Use [o índice](README.md) para escolher um guia. A
[arquitetura](arquitetura-agentes.md) descreve o funcionamento; o
[roadmap](roadmap.md) contém propostas futuras e os [ADRs](adr/README.md)
registram decisões duradouras.
