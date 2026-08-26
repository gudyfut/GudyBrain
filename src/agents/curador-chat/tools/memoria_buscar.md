---
name: memoria_buscar
description: Busca conceitos existentes por texto, ID, estado ou relação estruturada quando a listagem não resolve uma ambiguidade.
parameters: {"type":"object","properties":{"consulta":{"type":"string"},"id":{"type":"string"},"pasta":{"type":"string"},"type":{"type":"string"},"natureza":{"type":"string"},"tag":{"type":"string"},"categoria":{"type":"string","enum":["Familia","Amigo","Conhecido"]},"vinculo":{"type":"string"},"estado":{"type":"string"},"relacionado_a_id":{"type":"string","description":"ID presente em participantes, membros ou lugares."},"criterios_sociais":{"type":"array","items":{"type":"string","enum":["proxima","muito_proxima","mais_proximas","distante","boa_afinidade","muita_afinidade","mais_afinidade","baixa_afinidade"]}},"proximidade_min":{"type":"integer","minimum":0,"maximum":5},"proximidade_max":{"type":"integer","minimum":0,"maximum":5},"afinidade_min":{"type":"integer","minimum":0,"maximum":5},"afinidade_max":{"type":"integer","minimum":0,"maximum":5},"tem_data_nascimento":{"type":"boolean"},"ordenar_por":{"type":"string","enum":["proximidade","afinidade","title"]},"ordem":{"type":"string","enum":["asc","desc"]}},"required":[]}
---

# memoria_buscar

Use para filtro exato, busca por conteúdo ou resolução de entidade. Para
identificar um possível equivalente pelo conjunto do contexto, prefira
`memoria_contextualizar`.
