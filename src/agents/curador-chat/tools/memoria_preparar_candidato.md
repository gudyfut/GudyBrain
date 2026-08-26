---
name: memoria_preparar_candidato
description: Prepara uma proposta sem escrever em disco. Recebe deltas por seção; o sistema monta e valida o documento completo.
parameters: {"type":"object","properties":{"acao":{"type":"string","enum":["criar","atualizar"]},"path_origem":{"type":"string"},"path":{"type":"string"},"tipo_memoria":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]},"frontmatter":{"type":"object"},"alteracoes":{"type":"array","items":{"type":"object","properties":{"secao":{"type":"string","enum":["Informações Gerais","Princípios e Valores","Características Físicas","Personalidade","Histórico","Interesses","Curiosidades","Relações","Sobre","Membros","Humor","Contexto","Detalhes","Alternativas","Pessoas","Lugar","Moradia","Visitas","Notas","Visão Geral","Estado Atual","Participantes","Decisões","Próximos Passos"]},"conteudo":{"type":"string"},"modo":{"type":"string","enum":["acrescentar","substituir"]}},"required":["secao","conteudo","modo"]}},"motivo":{"type":"string"},"natureza_proposta":{"type":"string","enum":["explicita","sintese_interpretativa"]},"avaliacao_novidade":{"type":"object","properties":{"classificacao":{"type":"string","enum":["nova","complementar","contradicao"]},"motivo":{"type":"string"}},"required":["classificacao","motivo"]},"evidencias":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string"}}},"required":["acao","path","tipo_memoria","frontmatter","alteracoes","motivo","natureza_proposta","avaliacao_novidade","evidencias"]}
---

# memoria_preparar_candidato

Você decide o destino semântico; o código preenche campos ausentes, preserva a
memória atual e controla títulos e ordem. Nunca envie Markdown de documento
completo. Em uma atualização, integre todos os fatos destinados ao mesmo path
numa única chamada. `avaliacao_novidade` registra por que o delta é novo,
complementar ou contraditório em relação à memória consultada.

Em `Pessoa > Relações`, envie um bloco por alvo no formato
`### [Nome](/social/pessoas/slug.md)` seguido de bullets. O preenchedor integra
novos bullets ao bloco existente e rejeita o formato antigo em linha única.
