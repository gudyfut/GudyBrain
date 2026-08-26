---
name: memoria_buscar
description: Busca conceitos por texto e filtros estruturados, inclusive relações por ID. Use para nomes/tópicos e para selecionar pessoas por categoria, vínculo, proximidade ou afinidade.
parameters: {"type":"object","properties":{"consulta":{"type":"string","description":"Nome, tópico ou texto livre; busca sem acento e sem diferenciar maiúsculas."},"id":{"type":"string","description":"Identificador interno exato mem_<uuid>, somente quando já fornecido pelo sistema."},"pasta":{"type":"string","description":"Subpasta opcional, como social/pessoas, projetos ou conhecimento/programacao."},"type":{"type":"string","description":"Pessoa, Grupo, Conhecimento, Evento, Projeto ou Lugar."},"natureza":{"type":"string","description":"Aprendizado, Opiniao, Hipotese ou Reflexao."},"tag":{"type":"string","description":"Tag exata."},"categoria":{"type":"string","enum":["Familia","Amigo","Conhecido"],"description":"Categoria social exata."},"vinculo":{"type":"string","description":"Vínculo exato, como Escola, Trabalho ou Faculdade."},"estado":{"type":"string","description":"Estado exato de Projeto, como Ideia ou Ativo."},"relacionado_a_id":{"type":"string","description":"ID de entidade presente em participantes, membros ou lugares."},"criterios_sociais":{"type":"array","items":{"type":"string","enum":["proxima","muito_proxima","mais_proximas","distante","boa_afinidade","muita_afinidade","mais_afinidade","baixa_afinidade"]},"description":"Critérios fechados para expressões sociais naturais; não combine com limites numéricos."},"proximidade_min":{"type":"integer","minimum":0,"maximum":5,"description":"Use só quando o usuário informar uma nota mínima explícita."},"proximidade_max":{"type":"integer","minimum":0,"maximum":5,"description":"Use só quando o usuário informar uma nota máxima explícita."},"afinidade_min":{"type":"integer","minimum":0,"maximum":5,"description":"Use só quando o usuário informar uma nota mínima explícita."},"afinidade_max":{"type":"integer","minimum":0,"maximum":5,"description":"Use só quando o usuário informar uma nota máxima explícita."},"tem_data_nascimento":{"type":"boolean","description":"true para nascimento conhecido; false para data null."},"ordenar_por":{"type":"string","enum":["proximidade","afinidade","title"],"description":"Campo de ordenação."},"ordem":{"type":"string","enum":["asc","desc"],"description":"Direção; padrão desc."}},"required":[]}
---

# Skill: memoria_buscar

Busca por texto e/ou filtros estruturados. Se não achar na primeira tentativa,
varie o termo antes de desistir. O retorno traz path, título, descrição e
metadados de identificação; para conteúdo completo, use `memoria_ler`.

Roteamento: pessoa → `social/pessoas`; grupo → `social/grupos`;
preferência/tópico → `conhecimento`; quando/aconteceu → `eventos`;
iniciativa/plano → `projetos`; onde → `lugares`.

Use `relacionado_a_id` somente quando um ID já tiver sido resolvido. Ele encontra
Projetos/Eventos em `participantes`, Grupos em `membros` e Eventos em `lugares`.

## Interpretação controlada dos filtros sociais

Use filtros apenas quando o pedido for uma **seleção de pessoas**. Para uma
pessoa nomeada, busque pelo nome e leia a ficha. Não deduza categoria, vínculo
ou nota a partir de prosa.

Mapeamento fechado:

- "família/familiar", "amigo" ou "conhecido" → `categoria` correspondente;
- vínculo explicitamente citado ("da escola", "da faculdade") → `vinculo`;
- "próxima/próximas" no sentido de relação pessoal → `criterios_sociais: ["proxima"]`;
- "muito próxima" → `muito_proxima`; "mais próximos" → `mais_proximas`;
- "distante/pouco próxima" → `distante`;
- "com afinidade/boa sintonia" → `boa_afinidade`;
- "muita afinidade" → `muita_afinidade`; "mais afinidade" → `mais_afinidade`;
- "baixa afinidade" → `baixa_afinidade`.

O código converte esses critérios nos limiares oficiais e rejeita combinações
contraditórias. Use filtros `_min`/`_max` apenas se o usuário fornecer uma nota
numérica explicitamente. `null` nunca satisfaz faixa numérica. "Próximo" com
sentido de tempo ou lugar não ativa proximidade. Fora desse vocabulário, peça
esclarecimento em vez de inventar um limiar. Nunca exponha as notas numéricas
na resposta ao usuário; traduza o resultado para linguagem humana.
