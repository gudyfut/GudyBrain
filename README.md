# GudyBrain

Assistente pessoal com memória Markdown, curadoria humana e captura, transcrição
e análise de chamadas do Discord.

O chat usa **Jev para decidir e recuperar memória** e **Responses API com o plano
ChatGPT para responder** (`gpt-6-luna` por padrão). Configure `TYPESAFE_API_KEY`
no `.env`, abra Configurações na interface e selecione **Continue with ChatGPT**.
Autorize o uso do plano e confira os modelos disponíveis para sua conta.
O chat não exige chave da API OpenAI; Jev exige credencial própria. Consulte o
[guia de configuração](docs/jev-memory.md). Chat e curadoria usam Responses API
e Jev; calls continuam usando GLM.

O chat também oferece entrada e resposta por voz com Gemini. Configure
`GEMINI_API_KEY` para usar o microfone e consulte o [guia da conversa por voz](docs/voice-chat.md).

A curadoria usa [escrita contratual por seção](docs/memory-writing.md): itens
tipados, Markdown gerado pelo código e revisão humana com proteção contra
sobrescrita de versões mais recentes.
`CHAT_MODE=legacy` restaura a conversa GLM anterior.

## Estrutura do repositório

```text
src/          aplicação TypeScript do Gudman
web_interface/ aplicação Next.js e backend local da interface web
memory/       acervo local ativo em Markdown (ignorado pelo Git)
memory-private/ cópia local histórica do acervo anterior (ignorada pelo Git)
memory-template/ contratos e modelos versionados, sem fatos pessoais
discordbot/   aplicativo Python de gravação, transcrição e automação de calls
docs/         decisões, arquitetura e roadmap
```

`src` significa **source**: contém o núcleo independente da interface, incluindo
agentes, prompts e ferramentas. A aplicação Next.js possui configuração,
dependências, páginas, componentes e BFF próprios em `web_interface/`. Dados
pessoais continuam fora de ambos, em `memory/`, e não são versionados.
`memory/` contém o acervo ativo; `memory-private/` pode guardar um acervo histórico
local. Os dois diretórios estão no `.gitignore`. Em uma instalação nova, crie
`memory/` a partir das instruções de [memory-template/index.md](memory-template/index.md); o Git não
entrega dados pessoais. A exclusão dos arquivos do Git vale para novos commits:
o histórico antigo ainda pode conter versões anteriores e exige uma operação
separada caso seja necessário apagá-las do histórico remoto.

Dentro de `src/`:

```text
core/         runtime, clientes GLM/Responses, autenticação e carregamento do .env
agents/       agentes coesos: código, instructions.md e tools/ lado a lado
tools/        handlers locais compartilhados e regras do bundle de memória
dev/          validações e smoke tests que não fazem parte do produto
```

Dentro de `web_interface/`:

```text
src/app/        páginas Next.js e Route Handlers
src/components/ workspaces e componentes React
src/server/     BFF local, filas e gerência de processos
src/dev/        validações exclusivas da interface
```

Veja [docs/arquitetura-agentes.md](docs/arquitetura-agentes.md) para os limites
de contexto, permissões e regras para criar agentes.

As [instruções de entrada para agentes](AGENTS.md) apontam para contexto sob
demanda e para os [ADRs](docs/adr/README.md). Mudanças complexas podem usar o
[fluxo de especificações](docs/spec-driven-development.md) em `specs/`.

## Branches

- `public`: versão publicada e branch padrão do GitHub.
- `codex/development`: desenvolvimento mais atualizado.
- `codex/testing`: ambiente de testes, inicialmente no mesmo commit de desenvolvimento.

As três branches publicam somente código, instruções e modelos. Acervos reais,
credenciais, gravações e configurações pessoais permanecem locais.

## Interface web

Na raiz do repositório:

```powershell
npm install
npm start
```

Abra `http://127.0.0.1:3000`. A interface reúne:

- conversa com etapas de busca visíveis, resposta transmitida em fragmentos e
  curadoria por botão;
- biblioteca e bancada visual de aprovação de memória;
- calls com o fluxo gravação → transcrição → análise → curadoria;
- inicialização e controle do Discord bot;
- automações e estado das integrações, sem mostrar as chaves.

Use `npm run build` para validar o build de produção e `npm run serve` para
servir esse build. O servidor escuta apenas no endereço local.

Veja [docs/interface-web.md](docs/interface-web.md) para a arquitetura e o
relatório completo da implementação. Os comandos da raiz encaminham para o
workspace `web_interface`, portanto não é necessário entrar na pasta.

## Desenvolvimento

Comandos de desenvolvimento do sistema TypeScript:

```powershell
npm run typecheck
npm run check:agents
npm run check:memory
npm run check:calls
npm run check:curation
npm test
npm run smoke:api
```

`smoke:api` faz chamadas reais à API; os demais comandos de validação são locais.

## Comandos do bot Discord

O bot é um aplicativo Python independente, com ambiente e documentação
próprios em [discordbot/README.md](discordbot/README.md).

Para iniciar o bot, entre na pasta `discordbot/`, ative o ambiente virtual e
execute:

```powershell
cd discordbot
.\.venv\Scripts\Activate.ps1
python -m gudybot bot
```

O entrypoint antigo `python bot.py` continua disponível por compatibilidade.

Antes de conectar, valide a instalação:

```powershell
python -m gudybot verificar
```

Comandos enviados no Discord:

- `!entrar`: entra no canal de voz de quem executou o comando.
- `!gravar`: inicia uma gravação separada por participante.
- `!parar`: encerra a gravação, salva a sessão e desconecta.
- `!sair`: sai do canal de voz; se estiver gravando, descarta a sessão atual.

As respostas operacionais são enviadas por DM para quem executou o comando.

## Comandos de transcrição

O comando manual para transcrever uma sessão é este, a partir de
`discordbot/`, com a `.venv` ativa:

```powershell
python -m gudybot transcrever 20260807-185240_a_20260807-185312
```

Substitua `20260807-185240_a_20260807-185312` pelo nome real da pasta dentro de
`discordbot/gravacoes/`.

Também funciona a partir da raiz do repositório sem ativar a `.venv`:

```powershell
.\discordbot\.venv\Scripts\python.exe -m gudybot transcrever `
  20260807-185240_a_20260807-185312
```

Opções úteis:

```powershell
python -m gudybot transcrever SUA_SESSAO --modelo whisper-large-v3-turbo
python -m gudybot transcrever SUA_SESSAO --forcar
```

O padrão é `whisper-large-v3`. Use `--modelo whisper-large-v3-turbo` apenas para
comparar com a versão mais rápida. `--forcar` ignora o cache local e transcreve
tudo novamente.

A montagem final remove previsões feitas nos separadores silenciosos e frases
recorrentes configuradas em
`discordbot/config/frases_alucinacao_transcricao.txt`. Nenhuma remoção fica
oculta: consulte `transcricao-qualidade.json` dentro da sessão para ver texto,
participante, horário e motivo. Baixa confiança isolada gera aviso, não remoção.

Por padrão, o bot pode transcrever automaticamente depois de `!parar`. Para
desabilitar, ajuste o `.env` da raiz e reinicie o bot:

```dotenv
DISCORDBOT_AUTO_TRANSCRIBE=false
```

O wrapper antigo ainda existe em `discordbot/scripts/transcrever_sessao.ps1`,
mas o comando recomendado é `python -m gudybot transcrever`.

## Comandos de análise de call

A análise manual só inicia quando a sessão contém `conversa.txt`. Dentro de
`discordbot/`, com a `.venv` ativa:

```powershell
python -m gudybot analisar 20260807-185240_a_20260807-185312
```

Da raiz, sem ativar o ambiente:

```powershell
.\discordbot\.venv\Scripts\python.exe -m gudybot analisar `
  20260807-185240_a_20260807-185312
```

A análise também pode ser iniciada pela página **Calls** da interface web.

O comando gera `analise-call.json` para o curador e `analise-call.md` para
leitura humana. O início do relatório descreve a atividade, o tom, a dinâmica e
os assuntos da call e classifica cada observação em Alto, Médio ou Baixo
potencial. Depois da extração, uma busca local anexa possíveis conceitos já
existentes sem alterar a evidência. O curador verifica essas pistas na memória
atual e classifica cada item como novo, complementar, reforço, contradição, já
memorizado, efêmero ou ambíguo antes de propor mudanças. `--forcar` ignora a
análise e os blocos em cache.

Para revisar propostas do relatório, use a curadoria na página **Calls**.

Nenhuma análise escreve na memória automaticamente. Somente propostas aprovadas
na revisão são persistidas.

A análise automática é opt-in e depende da transcrição automática. No `.env`
da raiz:

```dotenv
DISCORDBOT_AUTO_TRANSCRIBE=true
DISCORDBOT_AUTO_ANALYZE=true
```

Com isso, o fluxo após `!parar` é gravação → transcrição → análise, uma sessão
por vez, com progresso no terminal e por DM. Use
`DISCORDBOT_AUTO_ANALYZE=false` para desabilitar apenas a última etapa.
