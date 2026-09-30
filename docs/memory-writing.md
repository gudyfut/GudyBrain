# Seleção e escrita de memória

Conversar ou analisar uma call não altera a memória automaticamente. Curadores
preparam propostas, o código monta Markdown validado e uma pessoa revisa antes
de aprovar. A edição direta na biblioteca também é uma ação humana validada.

## Seleção no chat

Ao usar **Memorizar** ou `/memorizar`, o sistema captura o histórico disponível:

1. GPT extrai até 24 afirmações atômicas com sujeito, modalidade, autoria e
   citações vinculadas às mensagens.
2. O código confere IDs e citações exatas. Isso valida a origem, não prova a
   interpretação semântica.
3. Jev julga sustentação explícita, atribuição e utilidade futura. Usa Choice
   para tipo/seção e compara identidades, duplicatas e contradições.
4. Para criação, escolhe progressivamente uma subpasta dentro do tipo. Para
   atualização, mantém o caminho do registro existente.
5. GPT redige itens do contrato v2; o código exige fidelidade e agrupa itens do
   mesmo arquivo numa proposta para revisão.

Perguntas e hipóteses não viram fatos confirmados. Identidade incerta, duplicata
possível ou interpretação ambígua provocam abstenção. Contradição explícita gera
proposta sinalizada, preservando o anterior para revisão.

Os limiares atuais exigem sustentação/atribuição ≥ 0,85, utilidade ≥ 0,70 e
fidelidade final ≥ 0,90. Tipo/seção exigem confiança ≥ 0,65. São valores iniciais,
não medidas de verdade. Detalhes executáveis estão em
[`selection.ts`](../src/agents/curador-chat/selection.ts).

Limites da curadoria: 160.000 caracteres de histórico, 3.000 registros no
catálogo, 1.000 por tipo, 60.000 caracteres por memória comparada e dez minutos
por execução. Falhas ou limites excedidos nunca aprovam gravação automaticamente.

## Seleção em calls

Calls continuam usando GLM. O analista produz observações atribuídas; o curador
consulta a memória vigente, julga novidade e prepara deltas. Não é a mesma
seleção Jev do chat. Cada observação média/alta recebe um destino auditável.
Veja [Calls](calls.md) e [arquitetura](arquitetura-agentes.md).

## Contrato de escrita v2

O modelo propõe campos e inserções delimitadas, não um documento inteiro:

```json
{
  "versao": 2,
  "acao": "atualizar",
  "path": "social/pessoas/pessoa-exemplo.md",
  "tipo_memoria": "Pessoa",
  "frontmatter": {},
  "alteracoes": [{
    "secao": "Interesses",
    "modo": "acrescentar",
    "itens": [{
      "tipo": "interesse",
      "nome": "Xadrez",
      "detalhe": "joga semanalmente"
    }]
  }],
  "motivo": "Interesse recorrente explicitamente declarado",
  "natureza_proposta": "explicita",
  "evidencias": ["A pessoa afirmou que joga xadrez semanalmente."],
  "avaliacao_novidade": {
    "classificacao": "complementar",
    "motivo": "A ficha consultada ainda não registra esse interesse."
  }
}
```

Exemplo fictício: o destino precisa existir e ter sido consultado. Em calls,
`observacao_ids` vincula a proposta ao relatório.

| Item | Dados | Destino |
| --- | --- | --- |
| `fato` | `texto`, referências opcionais a IDs existentes | Seções comuns |
| `interesse` | `nome`, detalhe curto opcional | Pessoa / Interesses |
| `relacao` | `alvo_id` de Pessoa, lista de percepções | Pessoa / Relações |

O código escapa Markdown e gera links por ID. Campos desconhecidos, seções
incompatíveis e referências inválidas são recusados. `acrescentar` preserva o
existente e deduplica itens idênticos; `substituir` troca uma seção inteira e
exige revisão cuidadosa. A curadoria do chat usa apenas `acrescentar`.

Pastas, campos, ordem e finalidade das seções estão no
[guia de estrutura](estrutura-memoria.md) e no contrato
[`estrutura.ts`](../src/tools/memoria/estrutura.ts).

## Da proposta à persistência

1. O contrato valida os itens e campos.
2. `preencher.ts` monta o documento completo e preserva o conteúdo existente.
3. A bancada mostra evidências, decisões e diff para aprovação ou rejeição.
4. O escritor valida novamente caminho, schema, seções, IDs e referências.
5. Atualizações conferem o SHA-256 da versão revisada. Se o arquivo mudou,
   precisam de nova leitura/revisão.
6. Um lock `.write.lock` serializa escritores do backend; arquivos são
   publicados com operações atômicas. Criações não sobrescrevem destinos.

A revisão também protege conversões de criação conflitante em atualização:
o resultado mesclado precisa ser revisto novamente. Propostas antigas sem
revisão-base devem ser regeneradas.

As garantias são estruturais. Elas não provam que o fato é verdadeiro nem que
uma substituição preservou todo o sentido. Editores externos não respeitam o
lock; renomeação e atualização de backlinks não são uma transação recuperável
de vários arquivos. Um lock deixado após encerramento abrupto exige verificar
se há escritor ativo antes de removê-lo.

Os acervos ficam em `memory/` e, opcionalmente, `memory-private/`, ignorados
pelo Git. `memory-template/` contém somente modelos. A busca acompanha
subpastas, mas novos tipos/campos/seções precisam de alteração no contrato.
A escolha de pasta na criação do chat admite até 40 subpastas por decisão
e dez níveis.

## Verificação

`npm run check:writing`, `npm run check:selection` e `npm run check:curation`
usam fixtures locais e integram `npm test`.
`src/dev/sync-memory-contract.ts` sincroniza o schema da ferramenta de calls;
`check:agents` identifica divergências com o contrato.
