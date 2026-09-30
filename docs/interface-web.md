# Interface web

A aplicação Next.js reúne chat, biblioteca de memória, revisão, calls e
controle do bot. O servidor escuta em `127.0.0.1`; não é uma implantação
multiusuário na rede. Veja [configuração](configuracao.md) para iniciar.

## Páginas

| Página | Uso |
| --- | --- |
| Visão geral | Indicadores, últimas sessões e atalhos |
| Conversar | Chat flutuante, atlas e entrada/resposta por voz |
| Memória | Biblioteca, edição direta e bancada de propostas |
| Calls | Transcrição, análise e curadoria de gravações |
| Discord bot | Estado e controle do processo Python |
| Configurações | Conta ChatGPT, modelo, integrações e automações |

## Chat e atlas

A janela do chat pode ser arrastada pelo cabeçalho, recolhida e reposicionada.
O atlas mostra a árvore local mesmo antes da primeira mensagem. Você pode:

- arrastar a câmera, aplicar zoom e filtrar por nome/apelido/caminho;
- clicar em nós para ver detalhes e, quando disponível, abrir o documento;
- arrastar nós; a simulação acomoda posições, conexões e etiquetas;
- centralizar para restaurar câmera e posições da simulação;
- clicar numa mensagem para rever o percurso daquela resposta;
- pausar a animação ambiente.

Enviar uma mensagem e rever percursos preserva zoom/deslocamento da câmera.
Caminhos explorados ficam verdes; os trajetos até os arquivos finais ficam
dourados. A telemetria mostra triagem, percentuais, limiares, omissões e leituras
complementares. Os percentuais estimam relevância, não certeza dos fatos.

O grafo representa eventos da recuperação, não raciocínio privado do modelo.
Um documento aberto no inspector é a **versão atual**, que pode diferir da
versão usada numa resposta antiga. Os percursos visuais ficam na sessão da
página e não são restaurados depois de recarregar.

O histórico do conversador fica em RAM no servidor. **Nova conversa** cria
outra sessão; não apaga memórias profundas. Veja [busca Jev](jev-memory.md) e
[voz](voice-chat.md).

## Biblioteca e revisão

A biblioteca permite ler e editar Markdown integral. A bancada exibe
evidências, natureza da proposta, criação/atualização, diff e decisão.
Você pode aprovar ou rejeitar; uma atualização baseada numa versão antiga é
bloqueada para nova revisão.

Salvar pelo editor também valida schema, ID, seções e referências. Essa ação
humana é distinta da aprovação de um candidato; nenhum modelo grava sozinho.
Veja [o contrato de escrita](memory-writing.md).

## Organização técnica

```text
web_interface/src/
  app/          páginas e Route Handlers
  components/   interação, atlas, chat e reprodução de áudio
  server/       sessões, filas, revisão e controle de processos
  dev/          verificações da interface
```

O núcleo é importado de `src/`, sem um serviço TypeScript separado. A raiz é
resolvida por `src/core/project-root.ts`, inclusive quando o workspace inicia
de `web_interface/`. `/api/memory/atlas` fornece metadados locais, sem corpos
nem chamadas a modelos; a leitura de um documento é uma operação separada.

O bot iniciado pela web recebe um token de controle em memória e usa uma API
local na porta 8765. Call jobs usam filas; áudio permite HTTP Range e os
artefatos completos são carregados sob demanda.

Chaves e credenciais OAuth ficam no servidor. A transcrição ao vivo usa um
token temporário Gemini no navegador. Paths de memória, sessões e áudio são
validados antes do acesso. Dados locais não devem ser importados diretamente
por componentes cliente.

Para build, typecheck e regressões visuais, consulte
[desenvolvimento](desenvolvimento.md).
