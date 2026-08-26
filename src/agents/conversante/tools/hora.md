---
name: hora
description: Retorna a data e a hora atuais do sistema. Use quando o usuario perguntar que horas sao, que dia e, ou precisar da data/hora atual para qualquer fim.
parameters: {"type":"object","properties":{"fuso":{"type":"string","description":"Fuso horario opcional no formato IANA, ex: America/Sao_Paulo. Se omitido, usa o horario local do servidor."}},"required":[]}
---

# Skill: hora atual

Devolve a data e hora do instante em que foi chamada.

- O valor vem do relogio do servidor onde o agente roda.
- Se o usuario pedir "horario de Brasilia" ou algo parecido, passe `fuso: "America/Sao_Paulo"`.
