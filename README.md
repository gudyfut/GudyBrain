# GudyBrain

[![CI](https://github.com/gudyfut/GudyBrain/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](./LICENSE)
[![Read in English](https://img.shields.io/badge/read-English-blue.svg)](./README.en.md)

Assistente pessoal com **memória de longo prazo em Markdown**, curadoria humana
e um pipeline completo de **gravação, transcrição e análise de calls do
Discord**. Tudo roda localmente: a memória é sua, fica na sua máquina e nada é
persistido sem a sua aprovação explícita.

```text
você ──conversa──► Gudman (agente) ──consulta──► memory/ (Markdown local)
  │                                              ▲
  └──aprova──► revisão humana ◄──propostas── curadores (IA) ◄──┘
                                        ▲
call do Discord ──► gravação ──► transcrição ──► análise ──┘
```

## Destaques

- **Memória estruturada e portátil** — cada conceito (Pessoa, Grupo, Evento,
  Lugar, Projeto, Conhecimento) é um arquivo Markdown com YAML frontmatter, IDs
  imutáveis e links entre registros. Leitura humana, validação automática.
- **Curadoria humana obrigatória** — agentes de IA apenas *propõem* mudanças
  (deltas por seção). Um preenchedor determinístico monta o documento e só a
  revisão humana aprova a escrita. Nada é gravado por trás de você.
- **Pipeline de calls atribuídas** — o bot do Discord grava cada participante em
  trilha separada, transcreve via Groq (Whisper), monta a linha do tempo com
  autoria resolvida para a memória e produz um relatório de análise com
  evidências.
- **Interface web local** — chat em streaming, biblioteca de memórias, bancada
  de revisão com diff linha a linha, painel de calls e controle do bot em um
  só lugar (`http://127.0.0.1:3000`).
- **Arquitetura multiagente com fronteiras** — conversante, analista e curadores
  têm prompts, modelos, limites e permissões próprios; nenhum agente pode
  escrever na memória.

## Começo rápido

Requisitos: [Node.js](https://nodejs.org) 20+ e, para o bot do Discord,
[Python](https://www.python.org) 3.11+, [FFmpeg](https://ffmpeg.org) no `PATH`
e uma conta de bot no Discord.

```powershell
git clone https://github.com/gudyfut/GudyBrain.git
cd GudyBrain
npm install

# 1. configure as chaves (veja .env.example)
Copy-Item .env.example .env

# 2. crie o bundle de memória de demonstração (conteúdo fictício)
npm run memory:init

# 3. inicie a interface web
npm start
```

Abra `http://127.0.0.1:3000`. Com `GLM_API_KEY` configurada no `.env`, você já
pode conversar com o Gudman e testar a curadoria de memória com o bundle de
demonstração.

### Interface web

- **Conversar**: chat em streaming com o Gudman; o modelo ativo aparece no
  composer e é o configurado no `.env` (`GLM_MODEL`) ou no registro de agentes.
- **Memória**: biblioteca pesquisável, editor de Markdown e bancada de revisão
  com diff integral por linhas.
- **Calls**: pipeline visual `Gravada → Transcrita → Analisada → Curada`.
- **Discord**: inicia/encerra o bot, grava e transcreve sem sair da interface.
- **Configurações**: automações, integrações e o modelo de cada agente, sem
  expor chaves.

### CLI (compatibilidade)

```powershell
npm run chat                      # conversa com o Gudman no terminal
npm run call:analyze -- SESSAO    # analisa um transcript existente
npm run call:review -- SESSAO     # entrega o relatório ao curador e à revisão
```

No CLI, use `/memorizar` para curar a conversa atual, `/limpar` para nova
sessão e `/ajuda` para os comandos.

## Memória pessoal e privacidade

- `memory/` é o **seu** bundle: dados pessoais que nunca são commitados (a
  pasta está no `.gitignore`).
- `memory-seed/` traz um bundle de demonstração **fictício** usado por
  `npm run memory:init` para um clone funcionar de imediato.
- Chamadas ao modelo (z.ai/GLM) recebem apenas o conteúdo necessário ao agente;
  chaves ficam no `.env` local e nunca aparecem na interface.
- Áudio das calls fica local; trechos são enviados à Groq apenas durante a
  transcrição. Gravações, transcrições e o mapa Discord→memória são ignorados
  pelo Git.
- O servidor web escuta somente em `127.0.0.1`.

Saiba mais em [docs/estrutura-memoria.md](docs/estrutura-memoria.md).

## Bot do Discord

Aplicação Python independente, com documentação própria em
[discordbot/README.md](discordbot/README.md). Resumo:

```powershell
cd discordbot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m gudybot verificar   # valida a instalação sem conectar
python -m gudybot bot         # conecta o bot
```

Comandos no Discord: `!entrar`, `!gravar`, `!parar`, `!sair`. Após `!parar`,
o fluxo transcrição → análise pode rodar automaticamente (opt-in) e o
relatório chega à bancada de revisão pela interface web.

## Estrutura do repositório

```text
src/              núcleo TypeScript: agentes, ferramentas de memória e CLI
web_interface/    interface Next.js (workspace próprio com BFF local)
discordbot/       app Python de gravação, transcrição e automação de calls
memory-seed/      bundle de memória de demonstração (fictício)
docs/             arquitetura, schema da memória, interface e roadmap
```

## Comandos de validação

| Comando | O que faz |
| --- | --- |
| `npm test` | typecheck + todas as validações abaixo |
| `npm run typecheck` | contratos TypeScript (núcleo e web) |
| `npm run check:agents` | perfis, prompts, ferramentas e handlers |
| `npm run check:memory` | schema, IDs e integridade do bundle local |
| `npm run check:calls` | chunking de transcrição e relatório de análise |
| `npm run check:curation` | revisão e aplicação segura na web |
| `npm run build` | build otimizado do Next.js |
| `npm run smoke:api` | chamadas reais à API GLM (diagnóstico explícito) |

Suíte Python (a partir de `discordbot/`, com a `.venv` ativa):

```powershell
python -m unittest discover -s tests
```

## Documentação

- [docs/projeto.md](docs/projeto.md) — visão geral e funcionalidades
- [docs/arquitetura-agentes.md](docs/arquitetura-agentes.md) — fronteiras,
  permissões e pipeline dos agentes
- [docs/estrutura-memoria.md](docs/estrutura-memoria.md) — schema completo do
  bundle de memória
- [docs/interface-web.md](docs/interface-web.md) — arquitetura da interface web
- [docs/roadmap.md](docs/roadmap.md) — estado atual e próximos passos
- [discordbot/README.md](discordbot/README.md) — instalação e operação do bot

## Licença

Distribuído sob a licença [MIT](./LICENSE).
