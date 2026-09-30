---
name: memoria_preparar_candidato
description: Prepara uma proposta de call sem escrever em disco. Recebe deltas atribuídos por seção; o sistema monta e valida o documento completo.
parameters: {"type":"object","properties":{"acao":{"type":"string","enum":["criar","atualizar"]},"path_origem":{"type":"string"},"path":{"type":"string"},"tipo_memoria":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]},"frontmatter":{"type":"object"},"alteracoes":{"type":"array","maxItems":24,"items":{"type":"object","additionalProperties":false,"properties":{"secao":{"type":"string","enum":["Informações Gerais","Princípios e Valores","Características Físicas","Personalidade","Histórico","Interesses","Curiosidades","Relações","Sobre","Membros","Dinâmica","Humor","Acordos","Contexto","Detalhes","Alternativas","Visão Geral","Estado Atual","Participantes","Decisões","Propostas e Questões em Aberto","Próximos Passos","Pessoas","Lugar","Moradia","Visitas","Notas"]},"modo":{"type":"string","enum":["acrescentar","substituir"]},"itens":{"type":"array","minItems":1,"maxItems":50,"items":{"oneOf":[{"type":"object","additionalProperties":false,"properties":{"tipo":{"const":"fato","type":"string"},"texto":{"type":"string","minLength":1,"maxLength":2000,"pattern":"^[^\\r\\n]+$"},"referencias":{"type":"array","maxItems":10,"items":{"type":"string","pattern":"^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"}}},"required":["tipo","texto"]},{"type":"object","additionalProperties":false,"properties":{"tipo":{"const":"interesse","type":"string"},"nome":{"type":"string","minLength":1,"maxLength":60,"pattern":"^[^\\r\\n]+$"},"detalhe":{"type":"string","minLength":1,"maxLength":72,"pattern":"^[^\\r\\n]+$"}},"required":["tipo","nome"]},{"type":"object","additionalProperties":false,"properties":{"tipo":{"const":"relacao","type":"string"},"alvo_id":{"type":"string","pattern":"^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"},"percepcoes":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"string","minLength":1,"maxLength":1000,"pattern":"^[^\\r\\n]+$"}}},"required":["tipo","alvo_id","percepcoes"]}]}}},"required":["secao","modo","itens"]}},"motivo":{"type":"string"},"natureza_proposta":{"type":"string","enum":["explicita","sintese_interpretativa"]},"evidencias":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string","maxLength":240}},"observacao_ids":{"type":"array","minItems":1,"items":{"type":"string","pattern":"^obs_[0-9]{5}$"}},"versao":{"type":"integer","const":2}},"required":["versao","acao","path","tipo_memoria","frontmatter","alteracoes","motivo","natureza_proposta","evidencias","observacao_ids"],"additionalProperties":false}
---

# memoria_preparar_candidato

Envie um único delta integrado por path. O código preserva o arquivo e controla
sua estrutura. Cada `observacao_id` precisa ter sido classificado como `nova`,
`complementar` ou `contradicao`; atualizações exigem leitura integral do
destino. Proveniência pertence apenas a `evidencias` e `observacao_ids`.

Use `versao: 2` e alterações com `secao`, `modo` e `itens`.
Nas seções comuns, cada item é `{tipo: "fato", texto: "...", referencias: [ID]}`.
Em `Pessoa > Interesses`, use `{tipo: "interesse", nome: "...", detalhe: "..."}`.
Em `Pessoa > Relações`, envie `{tipo: "relacao", alvo_id: ID, percepcoes: ["..."]}`,
um item por alvo. O código resolve IDs, gera links e integra as percepções.
Textos são de uma linha; referências são IDs existentes, nunca URLs inventadas.
Não envie `conteudo`, `corpo` ou Markdown livre. Evidências ficam na revisão.
