---
name: memoria_ler
description: Lê o conteúdo COMPLETO de um conceito específico do bundle de memória, dado o path. Use depois de listar ou buscar para abrir conceitos relevantes e seguir seus links.
parameters: {"type":"object","properties":{"path":{"type":"string","description":"Caminho relativo a memory/, com ou sem .md. Ex.: 'social/pessoas/joao-silva'."}},"required":["path"]}
---

# Skill: memoria_ler

Abre o conceito completo (frontmatter + corpo) por path. Use depois de
`listar`/`buscar` nos conceitos relevantes — no máx. 2-3 por pergunta. Aceita
path com ou sem `.md`, sempre relativo ao bundle (sem `..`).
