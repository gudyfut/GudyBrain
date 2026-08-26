# Interface web unificada — relatório de implementação

## Resultado

O GudyBrain agora possui uma interface Next.js local que reúne conversa,
memória, calls e Discord sem substituir as regras já validadas do sistema. O
navegador funciona como camada visual; agentes, segredos, arquivos pessoais e
processos continuam no backend local.

Inicie na raiz com:

```powershell
npm start
```

Depois abra `http://127.0.0.1:3000`. O CLI anterior permanece disponível em
`npm run chat`.

## Organização da experiência

- **Visão geral:** indicadores, última call e atalhos para os fluxos mais usados.
- **Conversar:** chat com Gudman, resposta em streaming, atividade de tools,
  comandos documentados e botão direto para acurar a conversa.
- **Memória:** biblioteca pesquisável e bancada de curadoria em três colunas.
  Cada proposta informa se é adição ou atualização, evidencia renomeações,
  mostra citações e um diff integral por linhas. Remoções aparecem em vermelho
  com `-`; adições, em verde com `+`. Linhas propostas podem ser editadas com
  um clique e há um editor do arquivo completo. Ao decidir, o card permanece
  selecionado com estado visível (`Pendente`, `Aprovada`, `Rejeitada` ou
  `Erro ao aplicar`) e uma ação explícita avança para a próxima proposta. A
  biblioteca também permite editar e salvar diretamente o Markdown integral.
- **Calls:** histórico de sessões e pipeline visual `Gravada → Transcrita →
  Analisada → Curada`. Transcrição e análise são iniciadas com um clique;
  conversa, relatório e trilhas individuais são carregados sob demanda.
- **Discord bot:** inicia e encerra o processo Python, entra no canal atual de
  voz de quem controla, grava, para e sai. O controle usa uma API efêmera autenticada em
  `127.0.0.1`; mensagens operacionais continuam chegando por DM.
- **Configurações:** liga/desliga as automações de transcrição e análise,
  confirma integrações sem revelar chaves e mostra o modelo de cada agente.

## Arquitetura

```text
web_interface/
├── package.json        dependências e scripts exclusivos do Next.js
├── next.config.ts      tracing e raiz Turbopack do monorepositório local
├── tsconfig.json       aliases para web e núcleo compartilhado
└── src/
    ├── app/            páginas Next.js e Route Handlers
    ├── components/     workspaces interativos
    ├── server/         BFF, filas, curadoria e gerência de processos
    └── dev/            regressões exclusivas da interface

src/                    agentes, ferramentas, CLI e runtime compartilhado
discordbot/             captura e processamento Python
memory/                 dados Markdown acessados somente pelo backend
```

A raiz usa npm workspaces. `npm start`, `npm run build` e
`npm run check:curation` continuam funcionando sem exigir conhecimento do
subprojeto. A interface importa o núcleo localmente, sem criar um segundo
serviço HTTP ou duplicar agentes.

`src/core/project-root.ts` localiza a raiz do repositório ao subir a árvore de
diretórios. Assim `.env`, prompts, `memory/` e `discordbot/gravacoes/` continuam
resolvendo corretamente quando o Next é iniciado de `web_interface/`.

O bot ganhou `gudybot/control_server.py`, disponível somente quando iniciado
pela web com um token aleatório em memória. A aplicação Next não recebe nem
devolve `GLM_API_KEY`, `GROQ_API_KEY` ou `DISCORDBOT_API_KEY`.

## Responsividade e latência

O chat transmite fragmentos à medida que são produzidos e agrupa atualizações
visuais por frame para evitar renderizações excessivas. Transcrição, análise e
curadoria usam filas em segundo plano com polling leve; navegar ou digitar não
espera essas operações. Há apenas uma transcrição/análise manual ativa por vez,
evitando competição por CPU, rede e arquivos. Áudio usa HTTP Range e
`preload="none"`; transcrições completas só são lidas quando a aba é aberta.

## Fronteiras de segurança

- o servidor escuta em `127.0.0.1`, não na rede local;
- somente a revisão humana chama os handlers de escrita de memória;
- atualizações, inclusive as feitas pelo editor da biblioteca, preservam
  validação, IDs, proveniência e renomeação de links;
- paths de sessão, memória e áudio são validados no backend;
- gravações, transcrições, `.env` e caches continuam ignorados pelo Git.

## Validação

- build otimizado do Next.js (`npm run build`);
- typecheck e validações de agentes, memória, calls e curadoria (`npm test`);
- suíte Python do Discord bot (`python -m unittest discover -s tests`);
- verificação local do bot sem conexão ao Discord (`python -m gudybot verificar`);
- respostas HTTP dos endpoints locais e revisão do layout responsivo.
