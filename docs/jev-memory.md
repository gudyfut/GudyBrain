# Busca de memória com Jev

O chat padrão (`CHAT_MODE=jev`) separa seleção de contexto e geração da resposta.
Jev julga quais ramificações consultar; GPT pela Responses API inspeciona o
contexto e responde. O histórico pertence ao GudyBrain. Veja
[configuração](configuracao.md) para login e credenciais.

## Fluxo de uma mensagem

1. **Índice local.** O código reconstrói em RAM títulos, descrições, caminhos e
   apelidos da árvore. O catálogo completo alimenta o atlas e a busca local;
   não é enviado inteiro aos modelos.
2. **Triagem Jev.** Recebe mensagem, histórico e correspondências locais de
   nomes/apelidos. Uma pergunta Noul avalia se consultar memória profunda é útil.
   A busca começa com probabilidade ≥ 0,50 ou com uma identidade mencionada.
3. **Navegação progressiva.** Jev avalia os filhos das pastas visitadas em lotes
   de até 40. Pastas ≥ 0,35 e arquivos ≥ 0,55 avançam; caminhos de identidades
   mencionadas têm prioridade mesmo abaixo desses limiares.
4. **Leitura integral.** O código lê os arquivos escolhidos completos. Jev recebe
   metadados na navegação, não os corpos desses documentos.
5. **Conferência pelo conversador.** GPT recebe documentos já lidos e uma lista
   curta de candidatos. Pode pedir outros arquivos, explorar pastas ou refinar
   a consulta. Essa inspeção também acontece quando a triagem foi negativa.
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

**“O que decidimos sobre o site?”** Jev pode explorar Projetos e Eventos pelas
descrições. O conversador pode pedir o documento integral da iniciativa e de
uma reunião relevante antes de responder.

**“Explique um conceito geral.”** Jev pode dispensar a busca. O conversador
ainda confere candidatos locais para detectar alguma referência específica
que a triagem perdeu; não precisa abrir arquivos se nenhum for útil.

## Leitura complementar e limites

A inspeção usa JSON Schema estrito com `paths`, `folders` e `query`.
O código valida os caminhos; não há ferramentas de sistema expostas ao GPT.

| Etapa | Limite atual |
| --- | --- |
| Índice local | 2.000 nós, 200 pastas e profundidade 15 |
| Seleção inicial Jev | 40 pastas, 1.000 nós avaliados, 16 arquivos, 60.000 caracteres |
| Candidatos por inspeção GPT | Até 24 arquivos e 24 pastas |
| Pedidos por rodada | Até 8 arquivos e 4 pastas |
| Rodadas de inspeção | Até 4 |
| Contexto documental após leitura complementar | 240.000 caracteres totais |
| Mensagem atual | 20.000 caracteres |
| Histórico serializado mais mensagem | 160.000 caracteres |
| Documento individual | Até 512 KB |
| Tempo por chamada | Jev: 30 s; GPT: 180 s |

Um documento precisa caber **inteiro**. Se não couber no orçamento, é omitido
com motivo; não há truncamento silencioso. A leitura complementar pode recuperar
um arquivo omitido na seleção inicial. Exceder o índice ou o histórico gera
erro explícito, não uma resposta fingindo acesso completo.

Esses limites são operacionais; os percentuais são relevância estimada, não
certeza factual. Os limiares ainda precisam de calibração com perguntas rotuladas.

## Atlas, falhas e privacidade

Os eventos mostram triagem, nós avaliados, percentuais, leituras e omissões.
Caminhos explorados ficam verdes; trajetos dos arquivos finais, dourados.
O atlas representa etapas observáveis, não raciocínio privado do modelo.

Mensagem e histórico vão aos serviços usados no turno. Jev recebe metadados;
GPT recebe documentos selecionados. O catálogo integral permanece local.
A seleção rejeita caminhos externos, links simbólicos e junctions.

Falhas e cancelamentos não viram uma decisão de “não buscar”, nem gravam um
turno incompleto no histórico. Não há retry automático ou troca silenciosa de
provedor. A interface pode exibir texto parcial antes de uma falha.

O transporte chama `POST https://api.openai.com/v1/responses` com OAuth,
`store: false`, `stream: true` e contexto explícito, conforme a
[documentação de inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
O modelo não recebe ferramentas. Veja o [ADR 0003](adr/0003-modelo-via-responses-api.md)
para a decisão e [desenvolvimento](desenvolvimento.md) para as verificações.
