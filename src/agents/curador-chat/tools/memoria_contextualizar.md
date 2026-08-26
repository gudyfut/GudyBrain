---
name: memoria_contextualizar
description: Ranqueia memórias possivelmente relacionadas por texto, tipo, IDs de entidades e paths sugeridos, exibindo metadados de identificação.
parameters: {"type":"object","properties":{"consulta":{"type":"string"},"tipo_memoria":{"type":"string","enum":["Pessoa","Grupo","Conhecimento","Evento","Projeto","Lugar"]},"entidade_ids":{"type":"array","items":{"type":"string"}},"paths_sugeridos":{"type":"array","items":{"type":"string"}},"limite":{"type":"integer","minimum":1,"maximum":10}},"required":[]}
---

# memoria_contextualizar

Use para localizar qual conceito existente representa um assunto antes de
decidir criar outro. O ranking é um indício: leia o arquivo escolhido antes de
atualizá-lo.
