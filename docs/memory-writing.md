# Escrita contratual da memória profunda

Implementado na branch `jev-based-memory`: os curadores de chat e call enviam
dados no contrato v2. A persistência continua exclusiva da revisão humana.
A seleção com Jev está implementada para o chat. Calls mantêm sua análise e curadoria atuais.

## Interface da IA

O curador de call entrega uma proposta por arquivo a
`memoria_preparar_candidato`. A curadoria de chat usa o compilador local do
mesmo contrato tipado. Exemplo de proposta:

```json
{
  "versao": 2,
  "acao": "atualizar",
  "path": "social/pessoas/ana.md",
  "tipo_memoria": "Pessoa",
  "frontmatter": {},
  "alteracoes": [{
    "secao": "Interesses",
    "modo": "acrescentar",
    "itens": [{"tipo": "interesse", "nome": "Xadrez", "detalhe": "joga semanalmente"}]
  }],
  "motivo": "Preferência recorrente explicitamente declarada",
  "natureza_proposta": "explicita",
  "evidencias": ["Ana disse que joga xadrez semanalmente."],
  "avaliacao_novidade": {
    "classificacao": "complementar",
    "motivo": "A ficha consultada ainda não registra esse interesse."
  }
}
```

A contextualização prévia continua obrigatória durante a curadoria. Em calls,
`observacao_ids` vincula a proposta às observações classificadas do relatório.

Cada seção aceita um formato específico:

| Item | Campos | Destino |
| --- | --- | --- |
| `fato` | `texto`, `referencias` opcionais com IDs existentes | Seções comuns |
| `interesse` | `nome`, `detalhe` curto opcional | Pessoa / Interesses |
| `relacao` | `alvo_id` de Pessoa, lista `percepcoes` | Pessoa / Relações |

O agente não entrega `conteudo`, `corpo`, subtítulos ou links Markdown.
Textos têm uma linha, limites explícitos e caracteres Markdown escapados pelo
renderizador. Referências são resolvidas por ID; o código gera os links locais.
Relações são agrupadas por alvo. Campos desconhecidos e formatos incompatíveis
são recusados, não descartados silenciosamente.

`acrescentar` preserva o conteúdo existente e deduplica itens exatamente iguais
após normalização de espaços. Não confunde uma frase com sua negação, nem remove
acentos para decidir igualdade. `substituir` troca uma seção inteira e requer
que o curador tenha lido e preservado seus fatos ainda válidos. Continua sujeita
à revisão humana; o código não consegue provar preservação semântica.

## Responsabilidades dos arquivos

O catálogo em `src/tools/memoria/estrutura.ts` define pastas, campos, ordem e
finalidade detalhada de todas as seções. Ele alimenta os modelos versionados em
`memory-template/` e o contexto dos curadores. O acervo ativo fica em `memory/`
e o anterior em `memory-private/`; ambos são locais e ignorados pelo Git.

| Tipo / pasta | Seções e responsabilidades |
| --- | --- |
| Pessoa / `social/pessoas` | Informações Gerais: biografia e situação; Princípios e Valores: convicções atribuídas; Características Físicas: aparência; Personalidade: traços estáveis; Histórico: marcos e links para eventos; Interesses: catálogo conciso; Curiosidades: fatos distintivos; Relações: visão durável do dono da ficha sobre outra pessoa. |
| Grupo / `social/grupos` | Sobre: identidade; Membros: composição e papéis; Dinâmica: hábitos recorrentes; Humor: referências coletivas; Acordos: combinados efetivos. |
| Projeto / `projetos` | Visão Geral: objetivo; Estado Atual: situação; Participantes: envolvidos; Decisões: acordos efetivos; Propostas e Questões em Aberto: hipóteses não decididas; Próximos Passos: ações combinadas; Histórico: mudanças e marcos. |
| Evento / `eventos` | Contexto: acontecimento situado no tempo; Pessoas: participantes; Lugar: locais; Detalhes: desdobramentos. |
| Lugar / `lugares` | Moradia: residência e períodos; Visitas: passagens relevantes; Notas: características do local. |
| Conhecimento / `conhecimento` | Contexto: origem e aplicação; Detalhes: aprendizado/opinião própria; Alternativas: contrapontos. |

Metadados servem à identidade, descrição curta, filtros, estado e referências
estruturadas. Corpo contém os fatos organizados. Evidências, justificativas e
IDs de observações ficam na proposta de revisão. `index.md` pertence à navegação
e aos templates: a interface de criação de conceitos não o sobrescreve.

A busca Jev lê `index.md` de cada pasta e percorre as subpastas existentes, sem
depender dos nomes `convivencia` ou `projetos`. Ao criar uma ficha por curadoria
de chat, Jev escolhe progressivamente a subpasta a partir dessas descrições; a
atualização mantém o caminho da ficha existente. A escrita de call aceita
caminhos aninhados dentro da pasta do tipo. Mudar a árvore **dentro** dos tipos
existentes funciona sem alterar a busca, dentro dos limites operacionais (até 40
subpastas por decisão e dez níveis na seleção de criação). Criar um tipo novo, mudar o esquema de
frontmatter ou renomear seções exige atualizar o contrato em código, seus
modelos e validadores; isso não é inferido automaticamente dos arquivos.

## Validação e persistência

1. Contrato v2 valida formato, campos, tipos e referências dos itens.
2. Preenchedor produz o documento completo em ordem canônica.
3. Revisão humana recebe o resultado. O editor integral permanece disponível,
   mas usa as mesmas validações de estrutura e metadados.
4. Escritor valida novamente o documento completo, referências e pasta do tipo.
   ID, status e autoria são gerenciados pelo sistema.
5. Atualizações exigem SHA-256 do conteúdo usado como base. Se mudou, a escrita
   falha e exige nova leitura/revisão. Vale para propostas web e editor web.
6. Um lock `.write.lock` serializa os escritores do backend. A publicação de cada
   arquivo usa temporário e operação atômica; criação nunca sobrescreve destino.

Propostas antigas sem revisão-base devem ser regeneradas. Converter uma criação
conflitante em atualização na web exige uma segunda revisão do resultado mesclado.
Um lock deixado após encerramento abrupto não é removido automaticamente: confira
se não há processo escrevendo antes de removê-lo. Editores externos não respeitam
esse lock. Renomeação e atualização dos backlinks envolvem vários arquivos e
não constituem uma transação recuperável após falha no meio dessas operações.

Essas garantias tratam de estrutura e persistência. A verdade dos fatos, sua
relevância e a classificação semântica continuam dependendo da interpretação e
da revisão. Formatos antigos preservados pelo validador não são normalizados
automaticamente. O subconjunto YAML suportado é deliberadamente restrito a
campos planos e listas inline; strings especiais são citadas pelo serializador.

## Seleção de chat implementada com Jev

A implementação separa extração de fatos, julgamento e gravação.

1. Uma LLM extrai candidatos atômicos da conversa em JSON: sujeito, predicado,
   objeto, tempo, modalidade (fato, hipótese, desejo), autor e citações com IDs
   das mensagens. Um candidato deve expressar uma afirmação verificável.
2. O código confere a existência dos IDs e se cada citação aparece exatamente
   na mensagem atribuída. Isso confere proveniência, não implicação semântica.
3. Para cada candidato, Jev recebe um `state` compacto com o candidato, trechos
   de origem, contexto próximo, entidades resolvidas e memórias relacionadas.
4. Perguntas Noul independentes avaliam: há sustentação explícita? A atribuição
   está correta? A informação tem utilidade futura? Já está registrada? Existe
   contradição? O código combina decisões e encaminha ambiguidades à revisão.
5. Choice escolhe tipo e depois seção somente entre opções do catálogo, incluindo
   `nenhuma` e `ambigua`. Para resolver entidades, use apenas IDs enumerados pelo
   sistema, com opção de nenhuma correspondência. Não force uma opção existente.
6. A LLM prepara os itens v2 dos fatos aprovados pela triagem; a validação e a
   revisão atuais continuam obrigatórias antes da escrita.

Para evitar perder informação, primeiro extraia os candidatos; um filtro Jev
anterior à extração pode ser experimentado posteriormente, medindo falsos negativos.
Em calls, reutilize as observações atribuídas que o analista já produz.

Exemplo: “Antes eu gostava de café, agora prefiro chá” deve preservar a mudança
temporal. “Talvez eu abra uma empresa” pode ser uma ideia de Projeto, mas não
prova que a empresa existe. “Ele mudou de emprego” exige resolver o sujeito pelo
contexto antes de julgar ou escrever.

Alternativa com menos geração: Jev seleciona trechos já segmentados e uma LLM
normaliza apenas os escolhidos. É mais simples de auditar, mas frases com
pronomes, correções e múltiplos fatos exigem janelas sobrepostas e tendem a perder
informação se a segmentação for rígida. Não recomendo Jev como extrator textual.

Calibre limiares em um conjunto local rotulado de conversas: medir fatos úteis
perdidos, atribuições incorretas, duplicatas e contradições aceitas é mais útil
que adotar um limiar arbitrário. Probabilidade Noul não mede importância; para
prioridade use Score com critérios descritivos. Falha de API nunca implica
aprovação automática. Guarde decisões e evidências na revisão para auditoria.

Referências oficiais: [Noul](https://docs.typesafe.ai/primitives/noul) e
[Choice](https://docs.typesafe.ai/primitives/choice). São primitivas de julgamento;
o fluxo usa essas primitivas no GudyBrain.

## Verificação

`npm run check:writing` usa um bundle temporário fictício e nenhuma API. Cobre
os seis tipos, itens inválidos, escape, YAML, referências, escrita somente após
revisão, identidade, conflitos de versão, renomeação e lock. Integra `npm test`.
`src/dev/sync-memory-contract.ts` sincroniza o schema de ferramenta do curador de calls;
`check:agents` acusa divergência entre esses schemas e o contrato em código.


## Política operacional do chat

Memorizar captura o histórico naquele instante. GPT pela Responses API extrai até 24 afirmações;
complete=false ou citações inválidas interrompem a execução. Jev exige sustentação
e atribuição >=0,85 e utilidade >=0,70. Tipo/seção usam Choice com confiança >=0,65.
O tipo inteiro é comparado em lotes de 40: identidade >=0,85 sem outro candidato
>=0,40. Identidade incerta não permite criação. Duplicata >=0,80 descarta;
>=0,40 abstém. Contradição >=0,80 gera proposta sinalizada preservando o anterior;
valores intermediários abstêm. Redação final exige fidelidade >=0,90.
Esses limiares são iniciais e precisam de calibração com exemplos rotulados.

Chat usa apenas acrescentar e preserva metadados existentes. Itens do mesmo
arquivo são integrados numa proposta com evidências e decisões na bancada.
Limites: 1000 registros por tipo, 3000 no catálogo, 60000 caracteres por memória
comparada e 10 minutos por curadoria. Exceder um limite falha explicitamente.
Não há gravação automática nem fallback em erro de API.

A interface de terminal do GudyBrain foi removida. A Responses API faz a geração de texto; o worker de calls continua usado pelo bot. O grafo do chat
mostra eventos de navegação, não raciocínio privado. Permite zoom, inspeção de nós,
sequência de pastas e seleção final; árvores grandes mostram um recorte indicado,
expansível. Cancelamentos e erros encerram as animações sem fingir conclusão.
