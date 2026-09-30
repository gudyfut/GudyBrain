# Configuração

## Instalação básica

Requer Node.js 22 ou posterior e npm. Na raiz:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Preencha as credenciais necessárias abaixo e execute `npm start`. Abra
`http://127.0.0.1:3000`. Não sobrescreva um `.env` existente; acrescente somente
as opções necessárias. A interface abre sem um acervo cadastrado.
Para criar sua memória, siga [os modelos](../memory-template/index.md).

## Credenciais por recurso

| Recurso | Configuração |
| --- | --- |
| Chat e curadoria do chat | `TYPESAFE_API_KEY` e conta ChatGPT conectada na interface |
| Modelo Jev | `JEV_MODEL`, padrão `jev-latest` |
| Resposta e curadoria do chat | `OPENAI_MODEL`, padrão `gpt-6-luna` |
| Voz no chat | `GEMINI_API_KEY` |
| Análise e curadoria de calls | `GLM_API_KEY`; `GLM_BASE_URL` é opcional |
| Bot Discord | `DISCORDBOT_API_KEY` e instalação [Python](../discordbot/README.md) |
| Transcrição de calls | `GROQ_API_KEY` e FFmpeg |

O `.env.example` lista os valores iniciais. Credenciais de um provedor não
autenticam os demais. `CHAT_MODE=jev` é o padrão; `CHAT_MODE=legacy` usa o
conversante GLM anterior e exige `GLM_API_KEY`.

## Conectar ChatGPT

1. Abra **Configurações → Continue with ChatGPT**.
2. Entre na conta e autorize o uso do plano pelo aplicativo.
3. Escolha um modelo no catálogo retornado para essa conta.
4. Inicie **Nova conversa** depois de trocar o modelo ou a conta.

O servidor usa OAuth e chama diretamente a Responses API. Não precisa de API
key OpenAI nem de login na CLI Codex. O seletor salva `OPENAI_MODEL` no `.env`;
a disponibilidade depende da conta autorizada.

Credenciais ficam fora do repositório: `%APPDATA%/GudyBrain/chatgpt` no Windows
(DPAPI do usuário) ou `~/.config/gudybrain/chatgpt` em Unix (permissões restritas).
A interface permite selecionar, renovar e desconectar contas. Para revogar o
acesso no provedor e gerenciar limites, use **Configurações → Gerenciar uso**.

O aplicativo não ganha uma cota própria. A documentação da OpenAI informa que
a janela de cinco horas do Plus é compartilhada entre aplicativos que usam o
plano; essa janela não se aplica ao Pro. Não trate isso como garantia de cota
semanal ou acesso ilimitado: consulte a conta e a
[documentação oficial de uso](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## Automações de calls

```dotenv
DISCORDBOT_AUTO_TRANSCRIBE=true
DISCORDBOT_AUTO_ANALYZE=false
```

A análise automática exige as duas opções em `true`. Reinicie o bot depois de
alterá-las. O uso manual continua disponível em [Calls](calls.md).

## Se algo falhar

| Sintoma | Ação |
| --- | --- |
| Login ausente, revogado ou consentimento insuficiente | Reconecte a conta em Configurações |
| Modelo indisponível | Atualize o catálogo e escolha um modelo da conta |
| Sessão antiga ou modelo anterior | Inicie Nova conversa |
| Resposta vazia, fluxo interrompido ou erro da API | Use **Testar comunicação** em Configurações para isolar a conexão |
| Cota atingida | Confira Gerenciar uso ou o painel do provedor indicado |
| Microfone indisponível | Confira `GEMINI_API_KEY`, permissão do navegador e o [guia de voz](voice-chat.md) |
| Bot não inicia | Execute `python -m gudybot verificar` conforme o [guia do bot](../discordbot/README.md) |

**Testar comunicação** faz duas chamadas reais pequenas: texto e saída
estruturada. Outros diagnósticos pagos estão separados dos testes locais no
[guia de desenvolvimento](desenvolvimento.md). Depois de editar manualmente o
`.env`, reinicie o servidor e abra uma nova conversa.
