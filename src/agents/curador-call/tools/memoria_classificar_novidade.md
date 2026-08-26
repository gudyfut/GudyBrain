---
name: memoria_classificar_novidade
description: Registra a comparação verificável de cada observação da call com a memória atual antes de preparar candidatos ou finalizar cobertura.
parameters: {"type":"object","properties":{"avaliacoes":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"object","properties":{"observation_id":{"type":"string","pattern":"^obs_[0-9]{5}$"},"tipo_memoria":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]},"classificacao":{"type":"string","enum":["nova","complementar","reforco","contradicao","ja_memorizada","efemera","ambigua"]},"motivo":{"type":"string"},"path_comparado":{"type":"string"}},"required":["observation_id","tipo_memoria","classificacao","motivo"]}}},"required":["avaliacoes"]}
---

# memoria_classificar_novidade

Classifique depois de consultar o tipo. `complementar`, `reforco`,
`contradicao` e `ja_memorizada` exigem `path_comparado` previamente lido.

- `nova`: fato útil sem conceito correspondente;
- `complementar`: acrescenta algo relevante a conceito existente;
- `reforco`: só repete/confirma, sem delta útil;
- `contradicao`: informação nova incompatível que precisa preservar versões;
- `ja_memorizada`: conteúdo já está registrado;
- `efemera`: detalhe circunstancial sem valor permanente;
- `ambigua`: não há sustentação suficiente para registrar.
