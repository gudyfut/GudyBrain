# GudyBrain

[![CI](https://github.com/MuriloRFM/GudyBrain/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Leia em português](https://img.shields.io/badge/leia-portugu%C3%AAs-blue.svg)](./README.md)

A personal AI assistant with **long-term Markdown memory**, mandatory human
curation, and a complete **Discord call recording → transcription → analysis**
pipeline. Everything runs locally: the memory is yours, stays on your machine,
and nothing is persisted without your explicit approval.

```text
you ──chat──► Gudman (agent) ──reads──► memory/ (local Markdown)
 │                                        ▲
 └──approve──► human review ◄──proposals── curators (AI) ◄──┘
                                      ▲
Discord call ──► recording ──► transcription ──► analysis ──┘
```

## Highlights

- **Structured, portable memory** — every concept (Person, Group, Event, Place,
  Project, Knowledge) is a Markdown file with YAML frontmatter, immutable IDs
  and cross-links. Human-readable, machine-validated.
- **Mandatory human curation** — AI agents only *propose* changes as
  section-level deltas. A deterministic filler assembles the document and only
  the human review layer can approve writes.
- **Attributed call pipeline** — the Discord bot records each participant on a
  separate track, transcribes via Groq (Whisper), merges an attributed
  timeline and produces an evidence-backed analysis report.
- **Local web interface** — streaming chat, memory library, line-by-line
  review workbench, calls dashboard and bot control at `http://127.0.0.1:3000`.
- **Multi-agent architecture with hard boundaries** — conversational agent,
  analyst and curators each have their own prompts, models, limits and tool
  allowlists; no agent can write to memory.

## Quick start

Requirements: [Node.js](https://nodejs.org) 20+. For the Discord bot also
[Python](https://www.python.org) 3.11+, [FFmpeg](https://ffmpeg.org) on `PATH`
and a Discord bot account.

```bash
git clone https://github.com/MuriloRFM/GudyBrain.git
cd GudyBrain
npm install

# 1. configure your keys (see .env.example)
cp .env.example .env

# 2. create the demo memory bundle (fictional content)
npm run memory:init

# 3. start the web interface
npm start
```

Open `http://127.0.0.1:3000`. With `GLM_API_KEY` set in `.env` you can already
chat with Gudman and try memory curation on the demo bundle.

The legacy terminal chat is available with `npm run chat` (`/memorizar`
curates the current conversation; `/limpar` starts a new session).

## Privacy

- `memory/` is **your** personal bundle; it is gitignored and never committed.
- `memory-seed/` ships a **fictional** demo bundle used by
  `npm run memory:init` so a fresh clone works out of the box.
- Model calls (z.ai/GLM) receive only the content each agent needs; keys stay
  in the local `.env` and are never exposed by the interface.
- Call audio stays local; segments are sent to Groq only during transcription.
  Recordings, transcripts and the Discord→memory identity map are gitignored.
- The web server binds to `127.0.0.1` only.

## Repository layout

```text
src/              TypeScript core: agents, memory tools and CLI
web_interface/    Next.js interface (own workspace with a local BFF)
discordbot/       Python recording, transcription and call automation app
memory-seed/      fictional demo memory bundle
docs/             architecture, memory schema, web interface and roadmap
```

Validation: `npm test` (typecheck + agent, memory, call and curation checks),
`npm run build`, and the Python suite in `discordbot/`
(`python -m unittest discover -s tests`).

Full documentation in Portuguese under [docs/](./docs) and
[discordbot/README.md](./discordbot/README.md).

## License

Released under the [MIT license](./LICENSE).
