---
name: memoria_listar
description: Lista o índice de uma pasta da memória para conferir em lote quais conceitos já existem.
parameters: {"type":"object","properties":{"pasta":{"type":"string","description":"Pasta relativa a memory/, como social/pessoas, social/grupos, eventos, projetos ou lugares."}},"required":["pasta"]}
---

# memoria_listar

Use uma vez por tipo presente na conversa. A saída inclui o frontmatter de
identificação relevante. Evite uma consulta separada por nome.
