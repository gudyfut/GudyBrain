# Interface web

Workspace Next.js que reúne apresentação, rotas locais e orquestração humana.
Importa o núcleo em `src/`; o bot Python continua em `discordbot/`.

## Organização

| Diretório | Conteúdo |
| --- | --- |
| `src/app/` | Páginas, endpoints e callback OAuth |
| `src/components/` | Chat, atlas, revisão e voz |
| `src/server/` | Sessões, filas, acesso validado a arquivos e processos |
| `src/dev/` | Verificações da interface |
| `public/` | Recursos estáticos, incluindo o AudioWorklet |

## Executar

Na raiz do repositório:

```powershell
npm ci
npm start
```

Abra `http://127.0.0.1:3000`. `npm start`/`npm run dev` usam desenvolvimento.
Para produção: `npm run build`, depois `npm run serve`.
Para verificar somente este workspace:
`npm run typecheck --workspace @gudybrain/web-interface`.

O servidor escuta somente em localhost. Segredos e acervos são acessados no
backend; o navegador recebe metadados/documentos apenas pelos fluxos autorizados.
A transcrição Gemini usa um token temporário próprio, não a chave principal.

Veja [configuração](../docs/configuracao.md), [uso e arquitetura web](../docs/interface-web.md)
e [desenvolvimento](../docs/desenvolvimento.md).
