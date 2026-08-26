---
name: memoria_ler
description: Lê uma memória existente antes de preparar uma atualização.
parameters: {"type":"object","properties":{"path":{"type":"string","description":"Caminho relativo a memory/, com ou sem .md."}},"required":["path"]}
---

# memoria_ler

Leia sempre antes de atualizar. Envie somente deltas; o preenchedor preservará
o documento existente.
