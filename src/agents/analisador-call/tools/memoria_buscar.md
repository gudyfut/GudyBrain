---
name: memoria_buscar
description: Busca uma entidade específica já observada na call por nome, texto, ID ou relação estruturada, sem modificar a memória.
parameters: {"type":"object","properties":{"consulta":{"type":"string","description":"Nome ou termo específico já encontrado na call."},"id":{"type":"string","description":"ID mem_<uuid> recebido na transcrição ou em resultado anterior."},"pasta":{"type":"string","description":"Limite opcional, como social/pessoas, social/grupos, eventos, projetos ou lugares."},"type":{"type":"string","description":"Pessoa, Grupo, Conhecimento, Evento, Projeto ou Lugar."},"estado":{"type":"string"},"relacionado_a_id":{"type":"string","description":"ID presente em participantes, membros ou lugares."}},"required":[]}
---

Use para nome ambíguo, entidade mencionada fora da lista ou resolução por ID.
Não procure temas que não apareceram na call.
