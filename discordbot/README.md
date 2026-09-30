# Bot Discord

Aplicativo Python para gravar chamadas por participante e produzir transcrições.
A análise usa o núcleo TypeScript; a revisão de memória acontece na interface
web. O comando `python -m gudybot` controla o bot e o processamento de calls,
não é uma interface de conversa por terminal.

## Pré-requisitos

- Python 3.11 ou posterior e Git disponível no `PATH`.
- FFmpeg disponível no `PATH`; confira com `ffmpeg -version`.
- Bot criado no Discord Developer Portal, com **Message Content Intent** e
  **Server Members Intent** ativados.
- Permissões de canal: View Channels, Connect, Speak e Send Messages.
- Para análise: Node.js 22 ou posterior e `npm ci` executado na raiz.

## Instalar

No Windows, a partir da raiz:

```powershell
cd discordbot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Se a ativação for bloqueada, use o interpretador diretamente:
`.\.venv\Scripts\python.exe`. No Linux/macOS:

```bash
cd discordbot
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Use o `requirements.txt` fornecido. Ele fixa uma revisão do Pycord com a
correção de recepção DAVE; o bot verifica essa compatibilidade antes de iniciar.
Não substitua a dependência por outra versão sem validar essa recepção.

## Configurar

No `.env` da **raiz do repositório**:

```dotenv
DISCORDBOT_API_KEY=seu-token
GROQ_API_KEY=sua-chave-de-transcricao
GLM_API_KEY=sua-chave-para-analise-e-curadoria
DISCORDBOT_AUTO_TRANSCRIBE=true
DISCORDBOT_AUTO_ANALYZE=false
```

O token Discord é necessário para conectar; Groq e GLM são necessários somente
nas respectivas etapas. Veja [configuração geral](../docs/configuracao.md).

O diretório `config/` admite personalização local:

| Arquivo | Função |
| --- | --- |
| `glossario_transcricao.txt` | Grafia de nomes/termos; copie o arquivo `.example.txt` |
| `correcoes_transcricao.json` | Variantes → grafia canônica; copie o arquivo `.example.json` |
| `identidades_discord.json` | IDs Discord → IDs imutáveis de Pessoas e identidade do criador |
| `frases_alucinacao_transcricao.txt` | Frases recorrentes a filtrar e auditar |

Os três primeiros arquivos são pessoais e ignorados pelo Git. Para os formatos
e efeitos no processamento, consulte [Calls](../docs/calls.md).

## Verificar e iniciar

Dentro de `discordbot/`, com a `.venv` ativa:

```powershell
python -m gudybot verificar
python -m gudybot bot
```

`verificar` confere dependências, FFmpeg e configuração sem conectar ao Discord
nem mostrar o token. A página **Discord bot** da web também inicia/encerra o
processo local. Ela utiliza a `.venv` deste diretório quando disponível.

`python bot.py` e `python bot.py --check` permanecem por compatibilidade.

## Comandos no Discord

| Comando | Ação |
| --- | --- |
| `!entrar` | Entrar no canal de voz de quem executou |
| `!gravar` | Confirmar por DM e iniciar trilhas individuais |
| `!parar` | Finalizar gravação, salvar sessão e desconectar |
| `!sair` | Sair; descartar a gravação atual se estiver gravando |

As respostas operacionais são enviadas por DM. Avise os participantes antes
de gravar; o bot não publica automaticamente um aviso no canal. Se não conseguir
enviar a confirmação privada, não inicia a gravação.

O áudio é escrito em disco, em trilhas compactas com partes de até 30 minutos.
`session.json` preserva a linha do tempo real e as identidades Discord.
Interrupções deixam partes recuperáveis na próxima inicialização.

Sessões ficam em `gravacoes/`: começam com `gravando_` e recebem um nome com
início/fim ao finalizar. Os nomes das trilhas usam o nome global da conta ou
username, mais o ID; não usam o apelido do servidor como identidade.

## Transcrever e analisar

Ainda dentro de `discordbot/`, com o ambiente ativo:

```powershell
python -m gudybot transcrever SUA_SESSAO
python -m gudybot analisar SUA_SESSAO
```

Substitua `SUA_SESSAO` pelo nome da pasta em `gravacoes/`. A transcrição exige
áudio e Groq; a análise exige `conversa.txt`, dependências npm e GLM.
`--forcar` ignora o cache da etapa. Para comparar o modelo de transcrição:
`python -m gudybot transcrever SUA_SESSAO --modelo whisper-large-v3-turbo`.

A análise automática só funciona com `DISCORDBOT_AUTO_TRANSCRIBE=true` e
`DISCORDBOT_AUTO_ANALYZE=true`. A fila processa uma sessão por vez.
Revise propostas na página **Calls**; não existe mais `npm run call:review`.

Veja [o fluxo de calls](../docs/calls.md) para artefatos, cache e curadoria.

## Testes e dados

```powershell
python -m unittest discover -s tests -v
```

Os testes são locais. `gravacoes/`, `.venv/`, credenciais e configurações
pessoais não são publicados. Transcrever envia áudio à Groq; analisar e acurar
enviam contexto ao GLM. Os arquivos de origem e resultados permanecem locais.
