---
name: memoria_listar
description: Mostra o índice de uma pasta do bundle de memória (memory/), listando os conceitos disponíveis com títulos e descrições curtas. Use SEMPRE que precisar saber o que existe numa área antes de abrir conceitos específicos. É a forma barata de descobrir o conteúdo sem ler vários arquivos.
parameters: {"type":"object","properties":{"pasta":{"type":"string","description":"Caminho relativo dentro de memory/. Ex.: 'social', 'social/pessoas', 'conhecimento/programacao', ou vazio para a raiz."}},"required":[]}
---

# Skill: memoria_listar

Lista o índice de uma pasta (progressive disclosure). Use antes de abrir
conceitos, pra ver o que existe na área. Pasta vazia = índice raiz.

Pastas: `social/pessoas`, `social/grupos`, `conhecimento`, `eventos`,
`projetos`, `lugares`.
