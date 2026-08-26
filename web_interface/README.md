# Interface web do GudyBrain

Subprojeto Next.js local responsável apenas pela apresentação e pela
orquestração web. Agentes, ferramentas, memória e Discord bot permanecem na
raiz do repositório e são reutilizados sem duplicação.

## Estrutura

```text
src/app/          páginas e Route Handlers
src/components/   workspaces React e estado de interação
src/server/       BFF local, filas, filesystem e processos
src/dev/          validações específicas da web
```

## Comandos

Prefira executar da raiz do repositório:

```powershell
npm start
npm run build
npm run check:curation
```

Para trabalhar diretamente neste workspace:

```powershell
npm run start --workspace @gudybrain/web-interface
npm run typecheck --workspace @gudybrain/web-interface
```

O servidor escuta somente em `127.0.0.1`. Segredos, memórias e gravações nunca
devem ser importados em componentes cliente; o acesso pertence a `src/server/`.
