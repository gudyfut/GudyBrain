# Conversa ao vivo com GPT-Live

A branch `codex/gpt-live` usa GPT-Live para ouvir e falar continuamente. Jev
seleciona memória e Gudman consulta os documentos pelo fluxo existente. A voz
anterior, com transcrição e síntese Gemini, está em `codex/voice-gemini`.

## Configurar

No `.env` da raiz, configure `GPT_API_KEY` com uma chave de projeto da OpenAI
que tenha acesso a `gpt-live-1`. Reinicie o servidor depois de editar o arquivo.
A chave permanece no servidor. Não use prefixo `NEXT_PUBLIC_`.

O backend de memória exige `CHAT_MODE=jev`, `TYPESAFE_API_KEY` e uma conta
ChatGPT conectada em **Configurações**. A API key da voz não substitui esse
login. O modo GLM legado continua disponível para texto; não atende a voz Live.

| Opção | Padrão | Limite |
| --- | --- | --- |
| `GPT_LIVE_VOICE` | `marin`, com instruções de fala em português brasileiro | Nome de voz suportada; `bossa` e `tempo` são alternativas com influência brasileira |
| `GPT_LIVE_IDLE_SECONDS` | `90` | Inteiro entre 15 e 300 segundos |
| `GPT_LIVE_MAX_SECONDS` | `1800` | Inteiro entre 60 e 7200 segundos |

Abra **http://127.0.0.1:3000/chat** com `npm start`. Microfone e WebRTC exigem
um navegador compatível em contexto seguro, como localhost. Execute o servidor
Node continuamente; o controle da voz não é adequado a funções serverless.

## Usar

1. Clique no microfone **Iniciar conversa ao vivo** e autorize a captura.
2. Aguarde **Conversa ao vivo**. Fale naturalmente e interrompa a fala quando
   precisar corrigir o pedido.
3. Use **Silenciar microfone** para suspender a entrada. Isso não encerra a
   sessão nem interrompe sua cobrança. Se o navegador bloquear áudio, clique em
   **Ativar som**.
4. Clique em **Encerrar** para fechar a sessão e liberar o microfone. O app
   informa se recebeu a duração final do provedor.
5. Continue por texto ou clique em **Memorizar** para preparar propostas. Cada
   proposta ainda precisa da sua aprovação na tela de revisão.

Durante a chamada, envio de texto e curadoria da mesma sessão ficam bloqueados.
**Nova conversa**, navegação para outra página e fechamento da aba também
encerram a captura. Só é permitida uma sessão Live por servidor local.
Não há retomada automática após uma queda: inicie outra chamada explicitamente.

## Memória, transcrições e interrupções

O navegador envia áudio diretamente à OpenAI por WebRTC. O servidor recebe
os eventos e áudio refletido pelo canal de controle; examina apenas a energia
do áudio para detectar atividade, sem salvá-lo. `store: false` não solicita
gravações recuperáveis pelo app; não substitui a política de retenção da API.

Pedidos que dependem de memória são delegados ao agente local. O resultado é
entregue em trechos ao GPT-Live, que o comunica com suas próprias palavras.
Uma correção enquanto a consulta está pendente cancela a execução anterior e
impede a entrega de seu resultado atrasado. A voz não tem ferramentas para
escrever arquivos, aprovar propostas ou executar comandos.

As transcrições e o histórico ficam em RAM e são perdidos ao reiniciar o
servidor. Deltas de texto não indicam turnos completos nem garantem o que foi
ouvido até uma interrupção; as legendas podem conter erros. A curadoria usa as
transcrições recebidas, nunca um rascunho completo do backend como se tivesse
sido falado. Revise as propostas antes de aprovar.

O contexto inicial enviado ao Live é um trecho recente do chat, com mensagens
inteiras. O agente de memória mantém acesso ao contexto local completo dentro
dos limites existentes. Ao atingir o limite de transcrição, a voz é encerrada;
inicie uma nova conversa se o histórico do chat atingir seu limite.

## Créditos e consumo

Na documentação consultada em 2026-11-09, GPT-Live custa **US$ 0,05/minuto**,
cobrado por segundo. O tempo inclui silêncio e espera por consultas. A criação
WebRTC cobra 15 segundos de inicialização, compensados na duração da sessão.
Os valores da interface são estimativas apenas de voz, não saldo de conta nem
orçamento garantido. [Preços](https://developers.openai.com/api/docs/models/gpt-live-1)
e [regras de cobrança](https://developers.openai.com/api/docs/guides/voice-latency-cost).

Créditos do benefício Pro podem cobrir GPT-Live quando vinculados à mesma
organização da chave. Eles expiram ao fim do ciclo. O backend Jev e a conexão
ChatGPT mantêm seus próprios limites; não entram na estimativa de voz exibida.
Confira o saldo e o acesso ao modelo na plataforma OpenAI.
[Condições do benefício](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).

A duração confirmada vem de `session.closed`. Em queda de conexão, o app
preserva o último valor observado e informa que o consumo final não foi
confirmado. O limite de duração e o encerramento por inatividade reduzem sessões
esquecidas; não substituem limites de gastos na conta da API.

## Verificar

- `npm run check:voice`: testes de protocolo e ciclo de vida com provedor simulado.
- `npm run check:voice-ui --workspace @gudybrain/web-interface`: testes de
  navegador com microfone/WebRTC simulados; requer web na porta 3100 e Chromium
  instalado via `npm exec --workspace @gudybrain/web-interface -- playwright install chromium`.
- A validação auditiva é manual: iniciar, perguntar sobre memória, corrigir
  durante uma consulta, interromper a fala e encerrar. Essa etapa usa créditos
  reais e não integra a suíte local.

Consulte a [decisão arquitetural](adr/0004-voz-live-com-delegacao-local.md).
