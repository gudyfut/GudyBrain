# Bot gravador de chamadas do Discord

Bot em Python que entra em um canal de voz e grava uma trilha WAV separada para cada participante. Todo o código e todas as dependências Python do projeto ficam nesta pasta.

## Estrutura

```text
discordbot/
├── bot.py                         # entrypoint compatível
├── gudybot/
│   ├── config.py                  # ambiente, caminhos e padrões
│   ├── discord_bot.py             # criação e eventos do cliente
│   ├── messaging.py               # mensagens privadas
│   ├── commands/recording.py      # comandos de voz
│   ├── audio/capture.py           # captura e linha do tempo
│   ├── audio/recovery.py          # recuperação após interrupções
│   ├── analysis/runner.py          # ponte para o analista TypeScript
│   └── transcription/
│       ├── automatic.py           # fila sequencial, logs e DMs
│       ├── groq.py                # preparação e API
│       ├── corrections.py         # normalização configurável e auditável
│       ├── quality.py             # filtro conservador e auditoria
│       └── timeline.py            # mesclagem cronológica
├── config/
│   ├── glossario_transcricao.txt
│   ├── correcoes_transcricao.json
│   ├── frases_alucinacao_transcricao.txt
│   └── identidades_discord.json # mapa local Discord ID → memory ID
├── scripts/transcrever_sessao.ps1 # compatibilidade com comandos antigos
├── gravacoes/
└── tests/
```

## Recepção de áudio DAVE

O Discord protege chamadas de voz com DAVE (criptografia ponta a ponta). O Pycord 2.8.0 decodifica esses pacotes incorretamente e encerra a gravação com `OpusError: corrupted stream`.

Por isso, `requirements.txt` fixa o commit `326b72acc8d1d952ac002fe07ca65581cf5952bc` da correção oficial de recepção do Pycord. O hash é fixo para que reinstalações sejam reproduzíveis. O bot também recusa iniciar se detectar novamente uma versão sem essa correção.

O projeto usa um sink próprio derivado de `discord.sinks.Sink`. Ele marca o instante de chegada de cada pacote antes do buffer de jitter, recebe o PCM decodificado e grava áudio estéreo de 48 kHz por usuário.

## Gravações longas e linha do tempo

O áudio não fica mais acumulado na RAM. Durante a chamada, cada trilha é escrita diretamente no disco como PCM temporário e, ao usar `!parar`, é finalizada como WAV.

Para evitar arquivos WAV acima de 4 GiB, cada participante é dividido automaticamente em partes de no máximo 30 minutos de áudio compacto. Períodos longos em que a pessoa não fala não ocupam espaço integral: o bot guarda apenas uma pequena separação no áudio e registra o intervalo real no manifesto.

Cada sessão contém um `session.json` que relaciona:

- tempo dentro do WAV compacto;
- tempo desde o começo da chamada;
- nome global da conta, username, apelido do servidor e ID do Discord;
- timestamps RTP, sequência e SSRC dos pacotes;
- intervalos de fala e eventuais sobreposições.

Na montagem da conversa final, o sistema resolve deterministicamente cada
participante por `Discord user_id → id da Pessoa → title atual`. Nenhum modelo
de IA é usado nessa identificação. Quando existe associação em
`config/identidades_discord.json`, `conversa.txt` mostra o nome cadastrado na
memória; se não existe, mantém o nome global/username do Discord.

Se o processo for encerrado inesperadamente, os arquivos `.pcm.part` são detectados e recuperados automaticamente na próxima inicialização do bot.

## Pré-requisitos

- Python 3.11 ou superior.
- Node.js e `npm install` executado na raiz para usar o analista de call.
- Git instalado e disponível no `PATH`, necessário para instalar o commit corrigido do Pycord.
- FFmpeg instalado e disponível no `PATH`.
- Conta gratuita na Groq e uma chave da API.
- Chave GLM no `.env` para análise manual ou automática.
- Aplicação/bot criado no Discord Developer Portal.
- `Message Content Intent` e `Server Members Intent` ativados no portal. O
  segundo permite associar ao membro os estados de voz recebidos na
  inicialização, inclusive quando ele entrou na call antes de o bot ligar.
- Permissões no servidor: View Channels, Connect, Speak e Send Messages.
- Arquivo `.env` na **raiz do repositório** contendo:

```dotenv
DISCORDBOT_API_KEY=seu_token_aqui
GROQ_API_KEY=sua_chave_groq_aqui
GLM_API_KEY=sua_chave_glm_aqui
# Opcional; use false para não transcrever automaticamente ao encerrar:
DISCORDBOT_AUTO_TRANSCRIBE=true
# A análise automática é opt-in e só funciona junto da transcrição automática:
DISCORDBOT_AUTO_ANALYZE=false
```

O token nunca deve ser commitado. O `.env` da raiz já é ignorado pelo Git.

## Conferir Python

No Windows:

```powershell
python --version
```

Se o comando `python` apontar para outra versão, tente:

```powershell
py -3.11 --version
```

No Linux/macOS:

```bash
python3 --version
```

O resultado precisa ser `Python 3.11` ou superior.

## Conferir e instalar FFmpeg

Confirme com:

```powershell
ffmpeg -version
```

Windows com Chocolatey, em um terminal administrativo:

```powershell
choco install ffmpeg
```

Alternativamente, baixe um build do FFmpeg, extraia-o e adicione a pasta `bin` à variável `PATH`. Feche e reabra o terminal depois de alterar o `PATH`.

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install ffmpeg
```

macOS com Homebrew:

```bash
brew install ffmpeg
```

## Instalação no Windows

Partindo da raiz do repositório:

```powershell
cd discordbot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Se a política do PowerShell bloquear a ativação, use apenas nesta sessão:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
```

No Linux/macOS:

```bash
cd discordbot
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Validar sem conectar

Dentro de `discordbot/`, com o ambiente virtual ativado:

```powershell
python -m gudybot verificar
```

O comando antigo `python bot.py --check` continua disponível.

Esse comando verifica Python, Pycord, a correção de recepção DAVE, PyNaCl, FFmpeg, `.env`, token e pasta de saída sem conectar o bot ao Discord e sem exibir o token.

O resultado correto inclui:

```text
Pycord: 2.8.1.dev91+g326b72acc
Recepção DAVE: correção instalada
Configuração válida. Nenhuma conexão com o Discord foi realizada.
```

Para executar os testes locais de regressão:

```powershell
python -m unittest discover -s tests -v
```

## Executar

Dentro de `discordbot/`, com o ambiente virtual ativado:

```powershell
python -m gudybot bot
```

O entrypoint `python bot.py` continua disponível por compatibilidade.

Uma conexão bem-sucedida mostra no terminal algo parecido com:

```text
Bot conectado como NomeDoBot#0000 (ID: 123456789...).
FFmpeg encontrado em: C:\caminho\ffmpeg.exe
```

Não feche o terminal enquanto estiver usando o bot.

## Comandos

- `!entrar`: entra no canal de voz de quem executou o comando.
- `!gravar`: envia uma confirmação privada e inicia a gravação separada por participante.
- `!parar`: encerra, finaliza as trilhas e o manifesto em `discordbot/gravacoes/` e desconecta.
- `!sair`: sai do canal; se estiver gravando, descarta a gravação atual.

Cada chamada cria uma pasta semelhante a:

```text
gravacoes/
└── 20260807-185240_a_20260807-185312/
    ├── session.json
    └── tracks/
        ├── Gudy_ID_parte001.wav
        ├── Alex_ID_parte001.wav
        └── Alex_ID_parte002.wav
```

O nome registra data e horário de início e fim, incluindo segundos. Durante a chamada a pasta começa com `gravando_`; ela é renomeada automaticamente ao finalizar. Se ainda houver colisão, o bot acrescenta `-2`, `-3` e assim por diante.

As trilhas usam o **nome global da conta** do Discord, e não o apelido definido
no servidor. Quando a conta não tem nome global, o bot usa o username; o ID
continua no nome do arquivo para evitar colisões. O `session.json` preserva
separadamente `global_name`, `username`, `guild_nickname` e `user_id`.
Caracteres inválidos para nomes de arquivo no Windows são substituídos.

## Transcrever uma sessão completa pela Groq

Por padrão, toda sessão com áudio é adicionada automaticamente a uma fila após
`!parar`. O bot processa **uma transcrição por vez**, mostra todo o progresso no
mesmo terminal e envia DMs quando o trabalho começa, termina ou falha. Uma
falha preserva a gravação e não bloqueia a próxima sessão.

Para desabilitar a automação, ajuste o `.env` da raiz e reinicie o bot:

```dotenv
DISCORDBOT_AUTO_TRANSCRIBE=false
```

O comando manual abaixo continua disponível e reutiliza qualquer trecho já
salvo no cache.

A transcrição não usa nenhum modelo local. O script converte temporariamente cada trilha para FLAC mono em 16 kHz, divide o áudio em trechos de até oito minutos e usa `whisper-large-v3` na API da Groq. Os FLACs temporários são apagados ao final.

Os cortes procuram intervalos de silêncio registrados no manifesto para não dividir uma palavra. Cada resposta traz timestamps por palavra, que são reposicionados primeiro dentro da trilha compacta e depois na linha do tempo global da chamada.

Dentro de `discordbot/`, com o ambiente virtual ativado, execute:

```powershell
python -m gudybot transcrever 20260807-185240_a_20260807-185312
```

Também funciona a partir da raiz do repositório sem ativar o ambiente:

```powershell
.\discordbot\.venv\Scripts\python.exe -m gudybot transcrever `
    20260807-185240_a_20260807-185312
```

O wrapper antigo continua disponível para compatibilidade:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\transcrever_sessao.ps1 `
    -Session 20260807-185240_a_20260807-185312
```

O modelo padrão é `whisper-large-v3`, priorizando qualidade. Para comparar com a versão mais rápida:

```powershell
python -m gudybot transcrever SUA_SESSAO `
    --modelo whisper-large-v3-turbo
```

Uma execução interrompida pode ser retomada com o mesmo comando. Cada trecho concluído é salvo imediatamente e reutilizado. `--forcar` ignora o cache e transcreve tudo novamente.

O arquivo `config/glossario_transcricao.txt` contém nomes e termos cuja grafia deve ser preservada. Edite-o livremente, mantendo uma lista curta. Os nomes dos participantes registrados no Discord são acrescentados automaticamente ao contexto.

O arquivo `config/correcoes_transcricao.json` mapeia variantes reconhecidas de
um termo para sua grafia canônica. As regras são aplicadas somente a palavras ou
expressões completas durante a montagem da timeline; variantes maiores têm
prioridade. Por exemplo, `Vega House` vira `V3ga House` antes que `Vega` possa
virar `V3ga`. A fala corrigida aparece em `text`, o valor original permanece em
`raw_text` e cada substituição é registrada em `transcricao-qualidade.json`.
Alterar esse arquivo e executar novamente a transcrição remonta a timeline usando
o cache da Groq, sem reenviar o áudio.

O arquivo `config/frases_alucinacao_transcricao.txt` contém clichês muito
característicos que o Whisper costuma inventar, como chamadas para inscrição em
canal. A filtragem ignora maiúsculas e acentos e tolera uma palavra intrusa. Só
o trecho correspondente é removido; palavras reais antes e depois são
preservadas. Adicione frases apenas quando forem artefatos recorrentes no seu
uso, pois uma correspondência real também será retirada da conversa final.

Além disso, previsões colocadas nos separadores silenciosos da gravação compacta
são descartadas. Segmentos com baixa probabilidade ou repetição anormal ficam
marcados para revisão, mas não são removidos somente por confiança baixa.

O arquivo local `config/identidades_discord.json` relaciona cada ID do Discord
ao `id` imutável de uma Pessoa em `memory/social/pessoas/` e identifica a Pessoa
criadora do sistema. Ele é ignorado pelo Git por conter identificadores pessoais:

```json
{
  "creator_person_id": "mem_00000000-0000-4000-8000-000000000000",
  "person_id_by_discord_id": {
    "123456789012345678": "mem_00000000-0000-4000-8000-000000000000"
  }
}
```

Títulos, apelidos e paths não devem ser usados nessa associação, pois podem mudar.

Arquivos finais:

- `conversa.txt`: leitura cronológica, com participante e começo/fim de cada fala;
- `conversa.json`: palavras, scores, horários absolutos, arquivos de origem,
  sobreposições e resumo de qualidade;
- `transcricao-qualidade.json`: tudo que foi removido e todo segmento suspeito,
  além das normalizações de grafia, com participante, arquivo, horários,
  texto original, destino e motivo;
- `transcricoes/`: resultados individuais da Groq e cache retomável dos trechos;

Exemplo:

```text
[00:12:14.320 - 00:12:16.810] Bianca: O Rafa saiu da call?
[00:12:15.950 - 00:12:18.120] Gudy: Acho que caiu a internet dele.
```

Como as vozes já vêm separadas pelo Discord, nenhuma diarização é usada.

Em `conversa.json`, cada participante e fala preserva `user_id` como string
(sem perda de precisão em integrações JavaScript) e
`discord_display_name`, acrescenta `person_id` quando resolvido e usa o `title`
atual em `display_name`. Reexecutar a transcrição reaproveita o cache da Groq e
remonta a timeline com eventuais alterações de nome feitas na memória.

O áudio é enviado à Groq durante a transcrição. As gravações originais, o manifesto, o cache JSON e os resultados continuam armazenados localmente.

## Analisar a conversa transcrita

O analista só pode ser executado depois que `conversa.txt` existir. Dentro de
`discordbot/`, com o ambiente ativado:

```powershell
python -m gudybot analisar 20260807-185240_a_20260807-185312
```

Ele usa `conversa.json` para preservar `person_id`, autoria e timestamps; se o
JSON não estiver disponível, consegue interpretar o formato textual com menos
contexto estruturado. Calls longas são divididas em blocos sobrepostos. Cada
bloco concluído fica em cache, permitindo retomar uma análise interrompida.
O relatório final só é reutilizado quando transcrição, modelo, versão das
instruções e contexto local da memória continuam compatíveis.

Depois da extração, o sistema avalia a conversa inteira como contexto:
atividade principal, tom, dinâmica, assuntos dominantes e densidade de
informações duráveis. Essa etapa gera um sinal de memória (`alto`, `medio` ou
`baixo`) e recomenda ao curador curadoria normal, seletiva ou não prioritária.
Uma call quase toda de partida e zoeira tende a receber sinal baixo, mas um fato
explícito relevante encontrado nela continua no relatório.

Em seguida, o sistema consolida observações de Pessoas, Grupos, Lugares,
Eventos e Conhecimentos. A memória é consultada somente para resolver entidades
já encontradas. Conhecimentos são aceitos apenas quando a evidência vem do
`creator_person_id` configurado.

Arquivos gerados:

- `analise-call.json`: contrato estruturado com contexto e recomendação entregue
  ao curador;
- `analise-call.md`: relatório legível com contexto global, recomendação,
  autoria, confiança e evidências;
- `analise-call/partes/`: cache retomável dos blocos.

Para ignorar todo o cache:

```powershell
python -m gudybot analisar SUA_SESSAO --forcar
```

Na raiz do repositório, a curadoria e a revisão humana são iniciadas com:

```powershell
npm run call:review -- SUA_SESSAO
```

O analista nunca escreve em `memory/`. O curador prepara candidatos e somente a
aprovação humana pode persistir cada mudança.

## Análise automática

Para executar o fluxo completo após `!parar`, habilite no `.env` da raiz:

```dotenv
DISCORDBOT_AUTO_TRANSCRIBE=true
DISCORDBOT_AUTO_ANALYZE=true
```

O bot processa gravação → transcrição → análise sequencialmente, uma sessão por
vez. Início, conclusão e falhas aparecem no terminal e são enviados por DM. Uma
falha de análise preserva áudio e transcrição e não impede a próxima sessão.

Se `DISCORDBOT_AUTO_TRANSCRIBE=false`, a análise automática permanece inativa
mesmo que `DISCORDBOT_AUTO_ANALYZE=true`. Para manter transcrição automática sem
análise, use `DISCORDBOT_AUTO_ANALYZE=false`.

## Teste rápido

1. Entre em um canal de voz no Discord.
2. Em um canal de texto onde o bot possa ler e responder, envie `!entrar`.
3. Confirme que o bot apareceu no mesmo canal de voz.
4. Envie `!gravar` e confirme que recebeu o aviso por mensagem privada.
5. Peça para duas pessoas falarem por alguns segundos.
6. Envie `!parar`.
7. Aguarde a confirmação da quantidade de arquivos.
8. Confira `discordbot/gravacoes/`.
9. Se a análise automática estiver habilitada, aguarde a DM de conclusão e
   confirme os arquivos `analise-call.json` e `analise-call.md` na sessão.

Erros técnicos completos ficam no terminal; o Discord recebe apenas mensagens amigáveis.

## Segurança e privacidade

- Avise e obtenha consentimento de todos os participantes antes de gravar.
- As mensagens operacionais do bot são enviadas por DM somente para quem executou o comando. Como não há mais aviso público automático, quem inicia a gravação é responsável por avisar os demais participantes.
- Se suas DMs do servidor estiverem bloqueadas, o bot avisará no canal e não iniciará a gravação.
- Restrinja quem pode usar os comandos por permissões/canais do Discord.
- `gravacoes/`, `.venv/` e qualquer `.env` dentro desta pasta são ignorados pelo Git.
- Não publique o token do bot nem os áudios sem autorização.
