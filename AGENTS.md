# Repository Guidelines

## Navigation First

Use the map below before searching the repository. Start with the named file or
directory for the task, use `rg` only inside that scope, and broaden the search
only when imports or references lead elsewhere. Do not inventory `memory/`,
`discordbot/gravacoes/`, or the whole repository unless the task requires it.

## Project Map

```text
README.md / README.en.md          repository overview (pt-BR and English)
AGENTS.md                         these guidelines
package.json                      workspace orchestration and core commands
tsconfig.json                     shared strict TypeScript rules
.env                              local secrets; never print or commit
.env.example                      documented template for .env

web_interface/                    independent Next.js workspace
├── package.json                  web-only scripts and dependencies
├── next.config.ts / tsconfig.json Next and TypeScript configuration
└── src/
    ├── app/                      pages and local route handlers
    ├── components/               interactive workspaces and navigation
    ├── server/                   local BFF, queues, processes and filesystem access
    └── dev/validate-web-curation.ts web curation regression check

src/                              Gudman TypeScript core
├── core/
│   ├── agent.ts                  generic tool-calling loop and Markdown loader
│   ├── glm.ts                    z.ai/GLM HTTP transport
│   ├── env.ts                    root .env loader
│   └── project-root.ts           stable repository-root resolution for workspaces
├── agents/
│   ├── registry.ts               model, temperature, limits, paths, allowlists
│   ├── pipeline.ts               operational stage, inputs, outputs and boundaries
│   ├── conversante/
│   │   ├── index.ts              builds Gudman and injects memory tree
│   │   ├── instructions.md       conversational behavior and memory policy
│   │   └── tools/*.md            tool schemas/guidance visible to Gudman
│   ├── analisador-call/
│   │   ├── index.ts              extraction, global context, consolidation, cache
│   │   ├── transcript.ts         safe session loading and transcript chunking
│   │   ├── report.ts / types.ts  context, recommendation and evidence contract
│   │   ├── instructions.md       attribution, evidence and interpretation rules
│   │   └── tools/*.md            read-only resolution tools
│   ├── curador-chat/             direct-chat curation profile and tools
│   ├── curador-call/             attributed call curation and coverage audit
│   └── curadoria/contexto.ts     shared compact memory contract for curators
├── tools/
│   ├── registry.ts               tool name to local handler mapping
│   ├── hora.ts                   current-time handler
│   └── memoria/
│       ├── buscar.ts             text/frontmatter search and people filters
│       ├── catalogo.ts           structured identity index and contextual ranking
│       ├── contextualizar.ts     short retrieval tool for existing concepts
│       ├── contextualizacao.ts   consultation and novelty audit state
│       ├── referencias.ts        immutable cross-memory reference validation
│       ├── listar.ts / ler.ts    progressive memory navigation
│       ├── candidato.ts          temporary candidate queue and validation
│       ├── preencher.ts          deterministic section-delta materialization
│       ├── estrutura.ts          canonical type and section contract
│       ├── escrever.ts           approved create/update/rename operations
│       ├── schema.ts / datas.ts  memory field and date validation
│       ├── ids.ts                immutable memory ID generation and validation
│       ├── template.ts           reads templates from memory indexes
│       ├── caminhos.ts           safe bundle path resolution
│       ├── frontmatter.ts        lightweight frontmatter parsing
│       └── arvore.ts             directory tree injected into prompts
├── cli/
│   ├── main.ts                   session commands and conversation flow
│   ├── analyze-call.ts           manual call-analysis entrypoint
│   ├── review-call.ts            call-analysis handoff to human review
│   ├── memory-review.ts          human approval boundary and writes
│   └── ui.ts                     terminal rendering
└── dev/
    ├── memory-init.ts             copies memory-seed/ into memory/ when absent
    ├── validate-agents.ts         local profile/tool consistency check
    ├── validate-memory.ts         schema, immutable ID and Discord-map checks
    ├── validate-call-analysis.ts  local chunk/report contract check
    └── smoke-api.ts               explicit real API diagnostic

memory/                            personal Markdown bundle; gitignored, never commit
├── index.md                       bundle overview
├── social/                        people and groups
├── eventos/                       Periodos, Acontecimentos and Encontros
├── projetos/                      initiatives from idea through completion
├── lugares/                       places
└── conhecimento/                  preferences and knowledge

memory-seed/                       fictional demo bundle copied by `memory:init`

discordbot/                       independent Python recording/transcription app
├── bot.py                        compatibility entrypoint
├── gudybot/
│   ├── cli.py                    `bot`, `verificar`, `transcrever`, `analisar`
│   ├── config.py                 environment and filesystem paths
│   ├── discord_bot.py            Discord client lifecycle
│   ├── commands/recording.py     voice commands and recording sessions
│   ├── audio/capture.py          per-user PCM/WAV capture and timing manifest
│   ├── audio/identity.py         account/global-name resolution
│   ├── audio/recovery.py         interrupted-session recovery
│   ├── messaging.py              private Discord responses
│   ├── analysis/runner.py        invokes the TypeScript call analyst
│   └── transcription/
│       ├── automatic.py          sequential automatic queue, logs and DMs
│       ├── identity.py           deterministic Discord ID-to-memory identity resolution
│       ├── groq.py               Groq transcription, chunking and cache
│       ├── corrections.py        configurable auditable term normalization
│       ├── quality.py            hallucination filtering and auditable quality decisions
│       └── timeline.py           chronological multi-speaker merge
├── config/
│   ├── glossario_transcricao.txt
│   ├── correcoes_transcricao.json  known variants to canonical spellings
│   ├── frases_alucinacao_transcricao.txt known recurring Whisper artifacts
│   └── identidades_discord.json     local Discord ID-to-memory-ID mapping; gitignored
├── tests/                        Python unittest regression suite
└── gravacoes/                    sensitive generated sessions; gitignored

docs/                             architecture, memory schema, roadmap, proposals
```

## Task Routing

- Change an agent's behavior: edit its `instructions.md`; inspect `index.ts`
  only if context assembly changes.
- Change model or permissions: `src/agents/registry.ts`.
- Change an agent's pipeline position or handoff contract: `src/agents/pipeline.ts`.
- Change a tool's API schema: the owning agent's `tools/*.md`.
- Change tool execution: `src/tools/registry.ts` and the matching handler.
- Change memory types/templates: relevant `memory/**/index.md`, then
  `src/tools/memoria/estrutura.ts` and `schema.ts` if validation changes.
- Change search/filter semantics: `src/tools/memoria/buscar.ts` and the
  corresponding agent tool guidance.
- Change contextual matching or novelty enforcement:
  `src/tools/memoria/catalogo.ts` and `contextualizacao.ts`.
- Change approval UX or persistence: `src/cli/memory-review.ts` or
  `src/tools/memoria/escrever.ts`; web review:
  `web_interface/src/components/memory-workspace.tsx` and
  `web_interface/src/server/curation.ts`.
- Change web navigation/pages: `web_interface/src/app/` and
  `web_interface/src/components/app-shell.tsx`; backend orchestration belongs
  in `web_interface/src/server/`, never in client components.
- Change call interpretation or report schema: `src/agents/analisador-call/`;
  curator handoff: `src/agents/curador-call/index.ts`. Direct-chat curation:
  `src/agents/curador-chat/`.
- Change Discord capture: `discordbot/gudybot/audio/`; commands:
  `discordbot/gudybot/commands/recording.py`; transcription:
  `discordbot/gudybot/transcription/`; analyzer subprocess:
  `discordbot/gudybot/analysis/runner.py`.

## Architecture and Safety Rules

Keep each agent's `index.ts`, `instructions.md`, and `tools/*.md` together.
Register every agent in `src/agents/registry.ts`; models are selected per agent
(`GLM_MODEL` only overrides the conversante profile). Every visible tool needs
both an allowlist entry and a handler. Conversational agents read memory; call
analysts produce attributed evidence with read-only resolution; curators
prepare candidates; only the human review layer may persist candidates.

Curators submit section-level deltas through `memoria_preparar_candidato`; they
must not reconstruct a complete memory document. The deterministic filler and
structural validator are shared by CLI, web review and direct edits.

Treat `.env`, `memory/`, recordings, and transcripts as sensitive. Preserve
unrelated worktree changes. Never expose secrets, rewrite personal memory, call
external APIs, connect the bot, or inspect recordings unless the task requires
it. `npm run smoke:api` makes real API calls and is never a routine test.

## Build, Test, and Development Commands

From the repository root:

- `npm start`: run the local Next.js interface at `http://127.0.0.1:3000`.
- `npm run chat`: run the legacy Gudman CLI.
- `npm run build`: validate the optimized web build.
- `npm run memory:init`: copy the fictional `memory-seed/` bundle into
  `memory/` when it does not exist yet.
- `npm test`: type-check and validate agent contracts locally.
- `npm run check:agents`: validate prompts, tool definitions and handlers.
- `npm run check:memory`: validate schemas, IDs and the local Discord mapping;
  skips with a notice when `memory/` is absent.
- `npm run check:calls`: validate transcript chunking and report rendering.
- `npm run check:curation`: validate review conflicts and safe body merging.
- `npm run call:analyze -- SESSION`: analyze an existing call transcript.
- `npm run call:review -- SESSION`: curate and review an analysis interactively.
- `npm run smoke:api`: explicit real GLM API diagnostic.

From `discordbot/` with `.venv` active:

- `python -m gudybot verificar`: validate installation without connecting.
- `python -m gudybot analisar SESSION`: analyze a session with `conversa.txt`.
- `python -m unittest discover -s tests -v`: run all Python tests.
- `python -m gudybot bot`: start the Discord bot.

Validate according to scope: TypeScript changes use `npm test`; agent changes
also require `check:agents`; Discord changes require `verificar` and Python
tests; documentation-only changes require `git diff --check`.

## Coding, Testing, and Contribution Style

Use two spaces in TypeScript and four in Python. Use `camelCase` for TypeScript
values, `PascalCase` for types/classes, `snake_case` in Python, and kebab-case
for agent directories and memory files. Keep TypeScript strict and free of
unused code. Python tests use `unittest` and `test_*.py`; no coverage threshold
is enforced.

Commit history uses short descriptive Portuguese subjects without mandatory
prefixes, for example `Ajusta identidade das gravações`. Keep commits focused.
Pull requests should describe behavior, validation performed, and schema or
configuration impact; include screenshots only for visible interface changes.
Never commit secrets, personal audio, recordings, or transcription caches.
