# Arquitetura de agentes

O sistema separa recuperação, resposta, extração de fatos, montagem determinística
e revisão humana. Cada etapa recebe seu contexto e permissões, sem herdar o
histórico interno de outros agentes.

## Responsabilidades

| Componente | Entrada e resultado | Permissões |
| --- | --- | --- |
| Recuperador Jev | Mensagem/histórico/metadados → seleção e eventos | Escolher nós enumerados pelo código |
| Conversador GPT | Histórico/documentos → inspeção e resposta | Pedir leituras estruturadas; sem ferramentas de sistema |
| Curadoria de chat | Conversa com citações → candidatos | GPT extrai/redige; Jev julga/roteia; código valida |
| Analista de call | Transcrição → relatório atribuído | Leitura dirigida; não prepara candidatos |
| Curador de call | Relatório + memória vigente → candidatos e cobertura | Leitura, contextualização e preparação |
| Preenchedor | Deltas + documento atual → Markdown validado | Não usa IA nem persiste |
| Revisão/editor humano | Proposta ou edição → documento persistido | Escrita validada e controle de versão |

## Fluxos

```text
Mensagem → índice local → Jev → documentos → inspeção GPT → resposta GPT
Chat → extração GPT → julgamento Jev → itens GPT → proposta → revisão → memory/
Call → analista GLM → curador GLM → proposta → revisão → memory/
```

O conversador não propõe nem grava memória. Os curadores não persistem;
os modelos fornecem dados delimitados e o código monta o documento.
A biblioteca também admite salvar uma edição humana com as mesmas validações.

Chat e calls têm curadores distintos: chat usa a conversa direta e citações
verificadas; calls exigem múltiplos autores, timestamps, confiança e cobertura
das observações. Ambos compartilham o contrato de memória.

## Configuração executável

- `src/agents/registry.ts`: perfis, valores padrão, prompts e ferramentas permitidas.
- `src/core/llm.ts`: contrato de geração e seleção de `OPENAI_MODEL`.
- `src/core/responses.ts` e `chatgpt-auth.ts`: transporte e autenticação ChatGPT.
- `src/core/jev.ts`: avaliações TypeSafe.
- `src/agents/pipeline.ts`: entradas, saídas e limites entre etapas.
- `src/tools/registry.ts`: handlers locais das ferramentas GLM.

Chat padrão usa Jev e Responses API sem ferramentas expostas ao modelo.
Calls e o chat `legacy` usam GLM com tool-calling. Uma ferramenta GLM precisa
de definição no agente, permissão no perfil e handler implementado.

`OPENAI_MODEL` e `JEV_MODEL` sobrescrevem os padrões do chat. Modelos GLM são
definidos nos perfis; não existe `GLM_MODEL` global. Veja
[configuração](configuracao.md) antes de trocar um modelo.

## Memória e escrita

`estrutura.ts` define tipos, campos e seções. `preencher.ts` compila itens v2;
`candidato.ts` valida propostas; `escrever.ts` protege persistência,
IDs, referências e revisão-base.

Recuperação descobre a árvore local; escrita exige pastas e schemas conhecidos.
Seções legadas podem ser preservadas nas condições do validador, mas agentes
não podem introduzir livremente seções novas. Veja
[estrutura](estrutura-memoria.md) e [seleção/escrita](memory-writing.md).

## Particularidades das calls

O analista extrai primeiro; a busca determinística acrescenta possíveis
correspondências, nunca evidências. O contexto global calibra a análise, mas não
prova um fato. O curador consulta os arquivos vigentes, mesmo com relatório em
cache, e classifica novidade, duplicata, contradição ou ambiguidade.

Pessoas/Grupos/Projetos/Eventos usam IDs estruturados para identificação.
O corpo guarda nomes, papéis e links legíveis. Conhecimento exige exposição
deliberada atribuída ao criador configurado. Veja [Calls](calls.md).

## Navegar no código

O [núcleo](../src/README.md), o [índice dos agentes](../src/agents/README.md)
e a [interface](../web_interface/README.md) detalham suas áreas.
As verificações estão em [desenvolvimento](desenvolvimento.md); decisões
duradouras e seus motivos, em [ADRs](adr/README.md).
