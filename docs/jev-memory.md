# Conversa com recuperação Jev e resposta GPT

A branch `jev-based-memory` usa `CHAT_MODE=jev` por padrão no chat web.
O histórico pertence ao GudyBrain. Cada mensagem passa por estas etapas:

1. **Índice local:** a cada mensagem, o código reconstrói em RAM a árvore de
   metadados e os nomes/apelidos cadastrados. A busca determinística de apelidos
   identifica caminhos como `Beto → social/...md` sem consultar um modelo.
   O catálogo completo alimenta o atlas local, mas não é enviado ao Jev nem ao GPT.
2. **Triagem Jev:** mensagem, histórico e apenas os acertos locais de nomes/apelidos
   sustentam a pergunta Noul sobre consultar memória profunda. O limiar é 0,5.
   Uma menção direta a nome/apelido
   também garante a busca; a interface explica essa regra sem alterar a
   probabilidade retornada pelo Jev.
3. **Navegação:** Jev avalia filhos por lotes de até 40; pastas com probabilidade
   >= 0,35 e arquivos >= 0,55 são escolhidos. Os caminhos de pessoas mencionadas
   têm prioridade, inclusive quando sua relevância estimada é baixa.
4. **Leitura integral e revisão:** o código lê os arquivos selecionados completos.
   Antes de responder, o conversador confere os documentos recebidos e uma lista
   local de até 24 arquivos candidatos e 24 pastas. Ele pode escolher até oito
   arquivos, abrir até quatro pastas ou propor outra consulta curta. Há até quatro
   rodadas; nenhuma recebe o catálogo completo. Essa conferência ocorre mesmo após
   triagem negativa. A inspeção tem instruções próprias em `inspecao-memoria.md` e usa JSON Schema estrito na Responses API para exigir `paths`, `folders` e `query`. Caminhos e formato continuam validados pelo código. O modelo não recebe ferramentas de sistema.
5. **Resposta:** GPT recebe o contexto integral final e distingue documentos lidos
   e arquivos omitidos por limite. `gpt-6-luna` é o padrão. A conferência acrescenta
   de uma a quatro chamadas GPT antes da resposta, aumentando latência e uso da cota.

As descrições vêm de `description` (até 300 caracteres); pastas usam `index.md`
com trecho inicial como alternativa. Apelidos vêm de `apelido`. Corpos completos
não são enviados ao Jev; vão ao GPT quando selecionados. O histórico vai para
ambos os serviços; o catálogo completo permanece local. Não há truncamento silencioso.

## Configuração

Requer Node.js 22 ou posterior. Inicie a interface em `http://127.0.0.1:3000`, abra **Configurações** e selecione **Continue with ChatGPT**. Entre na conta elegível e autorize o uso do plano. Não há API key OpenAI nem transporte CLI. Credenciais ficam fora do projeto, em `%APPDATA%/GudyBrain/chatgpt` no Windows (DPAPI por usuário), ou `~/.config/gudybrain/chatgpt` em Unix (permissões restritas).

Confira os modelos disponíveis no seletor de Configurações. Escolher um modelo salva `OPENAI_MODEL` no `.env`; inicie uma nova conversa para aplicá-lo. Cada registro de conta/workspace permanece separado. A conexão pode ser renovada ou desconectada pela interface; o acesso pode ser revogado também no ChatGPT.

Acrescente ao `.env` existente, preservando as demais configurações:

```dotenv
CHAT_MODE=jev
TYPESAFE_API_KEY=sua-chave-da-typesafe
JEV_MODEL=jev-latest
OPENAI_MODEL=gpt-6-luna
```

A chave Jev vem do [console TypeSafe](https://console.typesafe.ai/).
A assinatura ChatGPT não autentica o serviço TypeSafe. Não coloque chaves no Git.
O arquivo `.env.example` documenta as opções; não copie sobre um `.env` existente.
Reinicie `npm start` depois de mudar configurações e inicie uma nova conversa.

`npm start` abre a interface. O grafo de navegação mostra a
triagem, a exploração e a quantidade selecionada durante a busca. O modelo exibido
vem da sessão. A Responses API transmite fragmentos de texto durante a geração; a confirmação final é obrigatória antes de atualizar o histórico.

`CHAT_MODE=legacy` restaura a conversa anterior com GLM e ferramentas de leitura.
Analista e curador de calls continuam usando GLM e `GLM_API_KEY`.
A curadoria do chat usa GPT para extrair/redigir e Jev para decidir; veja
[seleção e escrita](memory-writing.md).
`/memorizar` mantém a fronteira de propostas e aprovação humana; Jev não escreve,
remove nem altera memórias.

## Acesso ao modelo

O servidor chama `POST https://api.openai.com/v1/responses` com uma credencial OAuth autorizada para usar o plano ChatGPT. Envia instruções e contexto explícitos, sem ferramentas, com `store: false` e `stream: true`. O histórico permanece no Gudman e é reenviado conforme necessário. A decisão está registrada no [ADR 0003](adr/0003-modelo-via-responses-api.md).

O uso compartilha a cota Codex/ChatGPT Work. Defina o limite do Gudman em Configurações → Uso no ChatGPT. Não há cota adicional nem troca automática para cobrança por API key. Login elegível, modelos e capacidades devem ser confirmados na conta.

## Limites e tratamento de falhas

- Índice local de até 2.000 nós, 200 pastas e profundidade 15;
  exceder esses limites interrompe o turno com erro explícito.
- A seleção inicial Jev visita até 40 pastas, avalia 1.000 nós e lê até 16 arquivos
  com orçamento de 60.000 caracteres. A leitura complementar permite até 240.000
  caracteres totais de documentos. Um arquivo precisa caber inteiro.
- Até 20.000 caracteres na mensagem atual e 160.000 no histórico serializado mais
  mensagem. O sistema pede `/limpar` ao exceder, sem cortar histórico silenciosamente.
- Arquivos maiores que 512 KB são rejeitados. Documentos que não cabem no orçamento
  são omitidos integralmente, e a resposta recebe `limited=true`.
- Os limiares são valores iniciais, ainda não calibrados com perguntas pessoais.
  Descrições ruins ou decisões equivocadas podem excluir registros relevantes.
- Timeout de 30 segundos por chamada Jev e 180 segundos para o GPT. Cancelar a
  resposta interrompe requisições e encerra o streaming HTTP. Uma falha não vira um
  “não buscar”: aparece como erro, e o turno não entra no histórico do servidor.
- Não há retries automáticos que multipliquem custo nem fallback silencioso para
  outro modelo/provedor. A interface pode mostrar texto parcial antes de uma falha;
  esse turno não é incorporado à memória curta usada nas próximas respostas.
- A enumeração rejeita caminhos externos, links simbólicos e junctions. Somente
  arquivos Markdown enumerados pelo código podem ser selecionados.
- A Responses API recebe somente o contexto montado pelo assistente, sem ferramentas ou acesso ao sistema de arquivos. Credenciais não são enviadas ao navegador nem registradas em logs. A renovação do acesso é serializada e salva de forma atômica.

## Verificação

```powershell
npm test
npm run build
npm run check:retrieval
npm run check:context
npm run check:responses
```

Os testes Jev usam um bundle fictício temporário e HTTP simulado, sem custo nem
memória pessoal. Cobrem triagem negativa, navegação, poda, histórico, seleção,
limites, respostas malformadas, erro de autenticação, cancelamento e caminhos.

Diagnóstico **opcional com chamada real**, consumindo a cota do plano ChatGPT e usando apenas
uma mensagem sintética:

```powershell
npm run smoke:responses
```

Contrato Jev implementado conforme a [referência HTTP oficial](https://docs.typesafe.ai/api)
e a [primitiva Noul](https://docs.typesafe.ai/primitives/noul).
