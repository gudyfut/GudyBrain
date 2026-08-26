---
name: memoria_preparar_candidato
description: Prepara uma proposta de call sem escrever em disco. Recebe deltas atribuídos por seção; o sistema monta e valida o documento completo.
parameters: {"type":"object","properties":{"acao":{"type":"string","enum":["criar","atualizar"]},"path_origem":{"type":"string"},"path":{"type":"string"},"tipo_memoria":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]},"frontmatter":{"type":"object"},"alteracoes":{"type":"array","items":{"type":"object","properties":{"secao":{"type":"string","enum":["Informações Gerais","Princípios e Valores","Características Físicas","Personalidade","Histórico","Interesses","Curiosidades","Relações","Sobre","Membros","Humor","Contexto","Detalhes","Alternativas","Pessoas","Lugar","Moradia","Visitas","Notas","Visão Geral","Estado Atual","Participantes","Decisões","Próximos Passos"]},"conteudo":{"type":"string"},"modo":{"type":"string","enum":["acrescentar","substituir"]}},"required":["secao","conteudo","modo"]}},"motivo":{"type":"string"},"natureza_proposta":{"type":"string","enum":["explicita","sintese_interpretativa"]},"evidencias":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string"}},"observacao_ids":{"type":"array","minItems":1,"items":{"type":"string","pattern":"^obs_[0-9]{5}$"}}},"required":["acao","path","tipo_memoria","frontmatter","alteracoes","motivo","natureza_proposta","evidencias","observacao_ids"]}
---

# memoria_preparar_candidato

Envie um único delta integrado por path. O código preserva o arquivo e controla
sua estrutura. Cada `observacao_id` precisa ter sido classificado como `nova`,
`complementar` ou `contradicao`; atualizações exigem leitura integral do
destino. Proveniência pertence apenas a `evidencias` e `observacao_ids`.

Em `Pessoa > Relações`, envie um bloco por alvo no formato
`### [Nome](/social/pessoas/slug.md)` seguido de bullets. O preenchedor integra
novos bullets ao bloco existente; proveniência e contexto episódico ficam fora.
