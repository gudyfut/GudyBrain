# Modelo de memória

Este diretório contém somente documentação e modelos de estrutura. O acervo
real fica em `memory/`, ignorado pelo Git. Cópias históricas locais podem ficar
em `memory-private/`, também ignorado.

Cada conceito é um arquivo Markdown com frontmatter YAML, `id: mem_<uuid-v4>`
imutável e seções canônicas por tipo. O código valida os campos e materializa
as seções; o modelo apenas propõe inserções delimitadas.

Tipos disponíveis: Pessoa, Grupo, Evento, Projeto, Lugar e Conhecimento. O
diretório `conhecimento/` é opcional: não é necessário criá-lo em um acervo
focado em grupos. A distribuição em subpastas dentro da pasta de cada tipo pode
ser alterada; cada subpasta deve ter um `index.md` curto que explique seu escopo
para a navegação progressiva.

Não inclua dados pessoais neste diretório de modelos. Para começar um acervo
novo, crie `memory/index.md` com o escopo do assistente e copie apenas os
`index.md` dos tipos que usará. Os conceitos serão criados pelo fluxo de
curadoria e aprovação, ou inseridos manualmente seguindo o contrato do tipo.
