---
name: memoria_template
description: Retorna definição, campos, seções, finalidades e convenções do tipo de memória solicitado.
parameters: {"type":"object","properties":{"type":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]}},"required":["type"]}
---

# memoria_template

Chame uma vez por tipo e respeite o destino semântico de cada seção.
