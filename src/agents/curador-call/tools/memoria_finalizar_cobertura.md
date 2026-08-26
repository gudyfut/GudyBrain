---
name: memoria_finalizar_cobertura
description: Registra em lotes o destino das observações de potencial Alto ou Médio da call, sem escrever memória.
parameters: {"type":"object","properties":{"disposicoes":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"object","properties":{"observation_id":{"type":"string"},"decisao":{"type":"string","enum":["proposta","ja_memorizada","descartada","incorporada_em_evento","incorporada_em_projeto"]},"motivo":{"type":"string"},"path_candidato":{"type":"string"}},"required":["observation_id","decisao","motivo"]}}},"required":["disposicoes"]}
---

# memoria_finalizar_cobertura

Repita em lotes de até 20 até receber `Cobertura concluída`.
Antes, cada ID precisa passar por `memoria_classificar_novidade`.

- `proposta`: incorporada diretamente ao candidato indicado;
- `incorporada_em_evento`: representada pelo Evento indicado;
- `incorporada_em_projeto`: representada pelo Projeto indicado;
- `ja_memorizada`: leitura confirmou que não acrescenta informação;
- `descartada`: insuficiente, efêmera, artefato, insulto ou repetição; justifique.

Quando houver candidato, use o mesmo path e inclua o ID em `observacao_ids`.
