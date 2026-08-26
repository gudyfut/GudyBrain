# Memória do Alex

Bundle de demonstração do GudyBrain: todas as pessoas, grupos, lugares, eventos
e projetos abaixo são **fictícios**. Ao inicializar o assistente, este bundle
passa a ser a sua memória pessoal — nada dele é enviado para nenhum servidor e
ele nunca deve ser commitado (a pasta `memory/` fica no `.gitignore`).

Cada arquivo representa **um único conceito** e pertence ao domínio cujo
significado melhor descreve a informação:

- **social/pessoas/** — um indivíduo e informações próprias dele.
- **social/grupos/** — um coletivo reconhecível e seus membros.
- **conhecimento/** — aprendizado, opinião ou reflexão deliberada do dono da memória.
- **eventos/** — algo situado no tempo: Periodo, Acontecimento ou Encontro.
- **lugares/** — um local físico ou geográfico reutilizável.
- **projetos/** — uma iniciativa em ideia, planejamento, execução ou encerrada.

Cada conceito é um `.md` com YAML frontmatter + corpo markdown e recebe um
`id: mem_<uuid>` imutável, gerado pelo sistema. Relações vão no corpo como
links absolutos (`/social/pessoas/slug.md`). Slugs em minúsculo, sem acento,
kebab-case.

Agentes nunca criam títulos de seção livremente. O `index.md` de cada domínio
define campos, seções aceitas e o destino semântico de cada uma. A curadoria
entrega deltas por seção; o código monta e valida o documento completo.
