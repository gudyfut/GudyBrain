# Template: Pessoa

Cada arquivo representa **um indivíduo identificável**. A ficha reúne dados
próprios dessa pessoa. Um episódio temporal extenso pertence a Evento; uma
informação sobre o coletivo pertence a Grupo. Frontmatter `type: Pessoa`.

## Frontmatter
- `type: Pessoa` (fixo)
- `id`: identificador imutável `mem_<uuid>` gerado pelo sistema
- `title`: nome completo ("Bruno Sanches")
- `apelido`: string ou lista ("Zeta" ou ["Zeta", "Bruno"]); `null` se desconhecido
- `data_nascimento`: obrigatório — data completa em ISO `YYYY-MM-DD`, ou
  `null` quando ainda for desconhecida
- `description`: uma frase curta; `null` se ainda desconhecida
- `categoria`: `Familia` | `Amigo` | `Conhecido`; `null` quando não se aplica ou ainda é desconhecida
- `vinculo`: texto livre; `null` se desconhecido — se `Familia`, é o **papel** (Primo, Tio, Irmão, Mãe...); se `Amigo`/`Conhecido`, é o **contexto de origem** (Infancia, Trabalho, Faculdade...)
- `proximidade`: **int 0–5** (contato/proximidade) ou `null` — nunca "alta"/"baixa"
- `afinidade`: **int 0–5** (sintonia/interesses em comum) ou `null`
- `tags`: lista livre; use `[]` quando vazia
- (`id`, `status` e `generated` são gerenciados pelo handler de escrita — não inclua em propostas)

### Data de nascimento e idade

- Registre a data somente quando ela tiver sido dita de forma explícita. Se for
  desconhecida ou parcial, mantenha `data_nascimento: null`.
- Não armazene `idade`: ela é um valor derivado e fica desatualizada. Calcule-a
  a partir de `data_nascimento` e da data atual quando necessário.

## Corpo (ordem convencional)
O corpo contém somente a memória final para leitura humana. Não inclua IDs
`fala_`/`obs_`, timestamps de citação nem referências ao processo de transcrição.

- `## Informações Gerais` — profissão, formação, família, moradia e outros
  dados biográficos ou atuais que situam a pessoa; não colocar opiniões sobre
  terceiros nesta seção
- `## Princípios e Valores` — crenças, valores, convicções e prioridades
  declaradas; não inferir somente pelo comportamento
- `## Características Físicas` — aparência e características físicas
  observáveis; não misturar avaliações de personalidade
- `## Personalidade` — traços relativamente estáveis, autodeclarados ou
  sustentados; reação momentânea, insulto e brincadeira não são traços
- `## Histórico` — como se conheceram, marcos; linkar com
  `/social/pessoas/...`, `/lugares/...`, `/eventos/...`
- `## Interesses` — catálogo conciso de gostos, hobbies e preferências
  recorrentes. Use uma linha por item: `- **League of Legends** modo Arena.`
  Não narre episódios ou ocorrências nessa seção; quando forem duráveis, eles
  pertencem a `Histórico` ou Evento
- `## Curiosidades` — fatos duráveis e distintivos que não cabem melhor em outra seção
- `## Relações` — sempre a última seção; guarda o **modelo mental durável que a
  pessoa dona da ficha tem sobre o núcleo de outra pessoa**: caráter,
  personalidade, valores, motivações percebidas, qualidades, defeitos, confiança,
  admiração, respeito, aversão ou ressalvas pessoais. Use um bloco por alvo:

  ```markdown
  ### [Nome completo](/social/pessoas/slug.md)
  - Considera essa pessoa...
  - Vê nela...
  ```

As relações são estritamente direcionais: na ficha de Ana, o bloco de Bruno
descreve como **Ana vê Bruno**, nunca como Bruno vê Ana. Só registre uma opinião
declarada ou uma síntese interpretativa sustentada; a redação deve deixar claro
que se trata da perspectiva da dona da ficha, sem proveniência de call.

Não entram em `Relações`: parentesco ou tipo de vínculo; grau de proximidade;
história da convivência; atividades em comum; uma ação, fala, briga ou episódio
isolado; decisões de pagamento ou logística; aptidão para uma tarefa; papéis e
competências em grupo, empresa ou projeto; nem fatos objetivos sobre o alvo.
Esses dados vão, quando relevantes, para `Informações Gerais`, `Histórico`,
Evento, Grupo ou Projeto. Uma frase deve completar de modo útil “a pessoa da
ficha vê o alvo como...”; se apenas explica o que fariam juntos, descarte-a.

Todas as seções acima compõem a estrutura canônica e são criadas pelo sistema,
mesmo quando vazias. `Informações Gerais` e `Princípios e Valores` abrem o corpo
nessa ordem, e `Relações` encerra o documento.

## Convenções
- Todos os campos de conteúdo do template devem existir. Use `null` para valor desconhecido
  e `[]` para lista vazia; nunca omita uma chave.
- O `id` existe em todo arquivo persistido, nunca muda e não pode ser escolhido
  nem alterado por agente ou usuário durante a revisão.
- Relações ficam no corpo, agrupadas por subtítulos com links absolutos para
  outras pessoas, nunca no frontmatter.
- Slug do arquivo: minúsculo, sem acento, kebab-case.
