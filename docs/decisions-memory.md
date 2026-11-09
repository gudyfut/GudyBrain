# Busca de memória com Decisions

O chat padrão (`CHAT_MODE=decisions`) separa seleção de contexto e geração da resposta.
Decisions julga quais ramificações consultar; GPT pela Responses API inspeciona o
contexto e responde. O histórico pertence ao GudyBrain. Veja
[configuração](configuracao.md) para login e credenciais.

O adaptador envia `POST /v1/decisions` com `GPT_API_KEY` e `gpt-6-luna`.
Perguntas `predicate` retornam probabilidades; perguntas `choice` retornam uma
opção permitida, confiança e distribuição. Respostas são associadas pelo nome
da pergunta e validadas integralmente. Uma recusa, resposta incompleta ou erro
interrompe a operação, sem simular uma decisão negativa ou trocar de provedor.
O limite remoto de 400 perguntas é respeitado; a navegação usa lotes de 40.
A curadoria oferece de 2 a 255 alternativas por escolha, incluindo abstenção.
Veja o [contrato oficial](https://developers.openai.com/api/docs/guides/decisions)
e a [decisão arquitetural](adr/0005-selecao-memoria-via-decisions.md).

## Fluxo de uma mensagem

1. **Índice local.** O código reconstrói em RAM títulos, descrições, caminhos e
   apelidos da árvore. O catálogo completo alimenta o atlas e a busca local;
   não é enviado inteiro aos modelos.
   Se não houver documentos nesse índice, a seleção e a inspeção remotas são
   dispensadas: a resposta recebe explicitamente um contexto vazio.
2. **Triagem Decisions.** Recebe mensagem, histórico e correspondências locais de
   nomes/apelidos. Um predicado avalia se consultar memória profunda é útil.
   A busca começa com probabilidade ≥ 0,50 ou com uma identidade mencionada.
3. **Navegação progressiva.** Decisions avalia os filhos das pastas visitadas em lotes
   de até 40, reunindo até três pastas pendentes por rodada e executando até três
   chamadas simultâneas. Reutiliza os metadados do índice daquele turno, sem reler
   as pastas. Pastas ≥ 0,35 e arquivos ≥ 0,55 avançam; caminhos de identidades
   mencionadas têm prioridade mesmo abaixo desses limiares. Os limites são
   reservados antes das chamadas e os resultados aplicados em ordem determinística.
   Com orçamento esgotado, a janela de três pastas pode escolher uma fronteira
   diferente da navegação estritamente sequencial; a busca sinaliza essa limitação.
   Caminhos obrigatórios por título ou apelido são percorridos localmente, sem
   predicados redundantes nem probabilidades inventadas. As outras ramificações
   continuam sendo avaliadas para encontrar relações e documentos complementares.
4. **Leitura integral.** O código lê os arquivos escolhidos completos. Decisions recebe
   metadados na navegação, não os corpos desses documentos.
5. **Conferência pelo conversador.** GPT recebe documentos já lidos e uma lista
   curta de candidatos. Pode pedir outros arquivos, explorar pastas ou refinar
   a consulta. Essa inspeção também acontece quando a triagem foi negativa.
   Se todos os documentos indexados já foram lidos ou solicitados, a inspeção
   adicional é dispensada; omissões por orçamento continuam explícitas na resposta.
   Ao esgotar uma pasta solicitada, volta aos candidatos gerais. Um refinamento
   explícito substitui as preferências antigas da consulta. Se as quatro rodadas
   acabarem com documentos pendentes, o contexto informa essa limitação.
6. **Resposta.** GPT recebe o contexto final, arquivos omitidos e indicação de
   limites. A resposta chega em fragmentos; o turno só entra no histórico após
   conclusão confirmada.

As descrições dos arquivos vêm de `description`; pastas usam seu `index.md`,
com texto inicial como alternativa. Descrições têm até 300 caracteres.
Apelidos vêm de `apelido`. Uma boa descrição ajuda a distinguir arquivos sem
abrir todos eles.

## Exemplos

**“O que você acha do Beto?”** Se Beto estiver nos metadados de uma ficha, a
correspondência local obriga sua consulta, sem manter uma lista de apelidos no
prompt fixo. Títulos ou apelidos ambíguos podem corresponder a várias fichas.

**“O que decidimos sobre o site?”** Decisions pode explorar Projetos e Eventos pelas
descrições. O conversador pode pedir o documento integral da iniciativa e de
uma reunião relevante antes de responder.

**“Explique um conceito geral.”** Decisions pode dispensar a busca. O conversador
ainda confere candidatos locais para detectar alguma referência específica
que a triagem perdeu; não precisa abrir arquivos se nenhum for útil.

## Leitura complementar e limites

A inspeção usa JSON Schema estrito com `paths`, `folders` e `query`.
O código valida os caminhos; não há ferramentas de sistema expostas ao GPT.

| Etapa | Limite atual |
| --- | --- |
| Índice local | 2.000 nós, 200 pastas e profundidade 15 |
| Seleção inicial Decisions | 40 pastas, 1.000 nós navegados, 16 arquivos, 60.000 caracteres |
| Paralelismo Decisions | Até 3 requisições, cada uma com até 40 perguntas |
| Candidatos por inspeção GPT | Até 24 arquivos e 24 pastas |
| Pedidos por rodada | Até 8 arquivos e 4 pastas |
| Rodadas de inspeção | Até 4 |
| Contexto documental após leitura complementar | 240.000 caracteres totais |
| Mensagem atual | 20.000 caracteres |
| Histórico serializado mais mensagem | 160.000 caracteres |
| Documento individual | Até 512 KB |
| Tempo por chamada | Decisions: 30 s; GPT: 180 s |

Um documento precisa caber **inteiro**. Se não couber no orçamento, é omitido
com motivo; não há truncamento silencioso. A leitura complementar pode recuperar
um arquivo omitido na seleção inicial. Exceder o índice ou o histórico gera
erro explícito, não uma resposta fingindo acesso completo.
Se a leitura complementar recuperar todos os documentos do índice, a limitação
inicial já resolvida deixa de marcar a resposta como parcial.

Esses limites são operacionais; os percentuais são relevância estimada, não
certeza factual. Os limiares conservadores anteriores foram mantidos para a
migração; precisam de calibração com perguntas rotuladas do novo provedor.

## Atlas, falhas e privacidade

Os eventos mostram triagem, nós avaliados, percentuais, leituras e omissões.
Caminhos explorados ficam verdes; trajetos dos arquivos finais, dourados.
O atlas representa etapas observáveis, não raciocínio privado do modelo.

Mensagem e histórico vão aos serviços usados no turno. Decisions recebe metadados;
GPT recebe documentos selecionados. O catálogo integral permanece local.
A seleção rejeita caminhos externos, links simbólicos e junctions.

Falhas e cancelamentos não viram uma decisão de “não buscar”, nem gravam um
turno incompleto no histórico. Não há retry automático ou troca silenciosa de
provedor. Uma falha em um lote cancela as chamadas irmãs; resultados tardios não
entram no contexto. A interface pode exibir texto parcial antes de uma falha.

`npm run check:latency` compara navegação serial e otimizada com atraso artificial
e documentos fictícios, além de verificar concorrência, limites e cancelamento.
Os tempos desse teste não estimam a latência dos provedores. O índice continua
sendo reconstruído em cada turno para refletir alterações de memória.

O transporte chama `POST https://api.openai.com/v1/responses` com OAuth,
`store: false`, `stream: true` e contexto explícito, conforme a
[documentação de inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
O modelo não recebe ferramentas. Veja o [ADR 0003](adr/0003-modelo-via-responses-api.md)
para a decisão e [desenvolvimento](desenvolvimento.md) para as verificações.
