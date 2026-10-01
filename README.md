# GudyBrain

Assistente local com memória de longo prazo, conversa por texto e voz e análise
de chamadas do Discord. O **Gudman** consulta pessoas, grupos e projetos;
você decide quais propostas se tornam memória permanente.

## Começar

Requer Node.js 22 ou posterior. Na raiz do repositório:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Preencha `TYPESAFE_API_KEY` no `.env`, execute `npm start` e abra
**http://127.0.0.1:3000**. Em **Configurações**, conecte sua conta com
**Continue with ChatGPT** e escolha um modelo disponível. O padrão configurado
é `gpt-6-luna`.

Jev seleciona memória; a Responses API gera texto com o plano ChatGPT autorizado.
Não exige instalar Codex nem fornecer chave OpenAI. Voz e calls são opcionais
e têm credenciais próprias. Veja [configuração](docs/configuracao.md).

## O que você pode fazer

- **Conversar:** chat flutuante sobre um atlas interativo. Explore os nós,
  acompanhe a busca e reveja o percurso de cada resposta.
- **Falar e ouvir:** transcreva pelo microfone, revise o texto e escute a resposta.
- **Memorizar:** gere propostas a partir do chat e revise antes de aprovar.
- **Consultar e editar:** abra documentos na biblioteca; edições manuais também
  passam por validação.
- **Processar calls:** grave no Discord, transcreva, analise e revise propostas
  na página Calls. Instale o [bot Python](discordbot/README.md) para esse fluxo.

## Memória e dados locais

`memory/` guarda o acervo ativo; `memory-private/` pode guardar uma cópia
histórica. Ambos são ignorados pelo Git, assim como `.env`, gravações e
configurações pessoais do bot. O repositório fornece código, instruções e
modelos. Comece por [memory-template/index.md](memory-template/index.md).

Os dados ficam em arquivos locais, mas as etapas de IA enviam contexto aos
provedores configurados. Consulte os guias de busca, voz e calls.
O servidor é de uso local e individual; veja [segurança e privacidade](SECURITY.md).

## Organização

| Pasta | Responsabilidade |
| --- | --- |
| `src/` | Núcleo TypeScript, agentes, provedores e contratos de memória |
| `web_interface/` | Interface Next.js e servidor local |
| `discordbot/` | Bot Python, gravação e transcrição |
| `memory-template/` | Modelos sem dados pessoais |
| `docs/` | Guias, arquitetura e decisões |
| `specs/` | Modelos para especificar mudanças complexas |

| Branch | Papel |
| --- | --- |
| `public` | Versão publicada, padrão do GitHub |
| `codex/development` | Desenvolvimento mais atualizado |
| `codex/testing` | Testes; criada inicialmente como cópia de desenvolvimento |

## Documentação

O [índice de guias](docs/README.md) reúne os caminhos de leitura.

- [Configuração](docs/configuracao.md) · [Interface web](docs/interface-web.md)
- [Busca Jev](docs/jev-memory.md) · [Voz](docs/voice-chat.md)
- [Estrutura da memória](docs/estrutura-memoria.md) · [Seleção e escrita](docs/memory-writing.md)
- [Calls](docs/calls.md) · [Instalação do bot](discordbot/README.md)
- [Desenvolvimento](docs/desenvolvimento.md) · [Arquitetura](docs/arquitetura-agentes.md)

Para contribuir, consulte [AGENTS.md](AGENTS.md). `npm test` executa as
validações locais; `npm run build` gera produção e `npm run serve` serve esse
build. `npm start` e `npm run dev` iniciam o servidor de desenvolvimento local.
