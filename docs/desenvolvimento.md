# Desenvolvimento e validação

Execute os comandos npm na raiz. O projeto usa npm workspaces para encaminhar
os comandos da interface web. Consulte [configuração](configuracao.md) para
credenciais; elas não são necessárias para a suíte local com dados fictícios.

## Comandos principais

| Comando | Finalidade |
| --- | --- |
| `npm ci` | Instalar dependências do lockfile |
| `npm start` ou `npm run dev` | Servidor de desenvolvimento em `127.0.0.1:3000` |
| `npm run typecheck` | Contratos TypeScript do núcleo e da web |
| `npm test` | Suíte local do núcleo e da web, sem chamadas a provedores |
| `npm run build` | Build de produção |
| `npm run serve` | Servir o build de produção em localhost |

Evite gerar o build na mesma pasta enquanto o servidor de desenvolvimento está
usando `.next`. Use um checkout separado ou encerre o servidor antes.

## Verificações por área

| Área | Script |
| --- | --- |
| Perfis, prompts e ferramentas | `npm run check:agents` |
| Schema, IDs, modelos e acervo local, quando existir | `npm run check:memory` |
| Análise de calls | `npm run check:calls` |
| Aprovação e aplicação na web | `npm run check:curation` |
| Recuperação Jev | `npm run check:retrieval` |
| Escrita contratual | `npm run check:writing` |
| Seleção de fatos do chat | `npm run check:selection` |
| Inspeção e leitura integral de contexto | `npm run check:context` |
| OAuth e Responses API com respostas simuladas | `npm run check:responses` |
| Eventos de busca e estado visual | `npm run check:retrieval-view --workspace @gudybrain/web-interface` |

Essas verificações integram `npm test`. Os testes Python são independentes:

```powershell
# Em discordbot/, com a .venv ativa:
python -m unittest discover -s tests -v
```

Para o teste visual, inicie a web na porta 3100, por exemplo com
`npm run dev --workspace @gudybrain/web-interface -- --port 3100`, e execute
`npm run check:chat-ui`. Requer Playwright instalado; `PLAYWRIGHT_MODULE` aceita
a URL `file://` do módulo e `CHAT_TEST_URL` altera o endereço. O teste simula as
respostas do chat no navegador e não chama modelos.

## Diagnósticos com chamadas reais

Execute somente quando quiser testar a integração ou medir desempenho:

| Comando | Provedor/recurso |
| --- | --- |
| `npm run smoke:api` | GLM |
| `npm run smoke:responses` | ChatGPT via Responses API |
| `npm run benchmark:chat` | Jev e GPT, com memória fictícia |
| `npm run smoke:voice --workspace @gudybrain/web-interface` | Gemini: transcrição e síntese |
| `npm run benchmark:voice --workspace @gudybrain/web-interface` | Gemini: tempos de conexão, transcrição e áudio |

Esses comandos usam credenciais e cotas reais e não integram `npm test`.

## Onde alterar e documentar

Veja o [núcleo](../src/README.md), os [agentes](../src/agents/README.md) e a
[interface](../web_interface/README.md). Confirme scripts nos manifests.
Guias descrevem uso; [ADRs](adr/README.md) registram decisões duradouras;
[especificações](spec-driven-development.md) são opcionais para mudanças complexas.
Para documentação, confira links locais e execute `git diff --check`.
