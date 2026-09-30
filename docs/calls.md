# Calls: gravação, transcrição, análise e memória

O fluxo é **Discord → gravação → transcrição → análise → curadoria → revisão**.
Cada etapa gera artefatos locais; só a aprovação humana aplica propostas.
Para instalar e gravar, consulte [o bot](../discordbot/README.md).

## Pela interface web

1. Grave uma chamada pelo bot; a sessão aparece em **Calls**.
2. Use **Transcrever** para gerar a conversa.
3. Use **Analisar** para produzir observações atribuídas.
4. Inicie a curadoria e revise as propostas antes de aprovar.

A configuração pode automatizar transcrição/análise depois de `!parar`.
Curadoria e gravação de memória continuam sujeitas à revisão. Os comandos
manuais e opções do bot estão no seu README.

## O que cada etapa faz

| Etapa | Comportamento |
| --- | --- |
| Gravação | WAV por participante e manifesto com a linha do tempo real |
| Transcrição | Groq, padrão `whisper-large-v3`; cortes de até oito minutos, preferindo silêncio |
| Montagem | Reposiciona timestamps, combina falas, resolve identidades e audita correções |
| Análise | GLM interpreta blocos sobrepostos e consolida contexto/observações |
| Curadoria | GLM consulta a memória atual, julga novidade e prepara candidatos |
| Revisão | Pessoa confere evidências, diff e possíveis conflitos antes de aplicar |

A separação de vozes vem do Discord, sem diarização por modelo. Intervalos
compactados são convertidos de volta para o tempo da chamada. Baixa confiança
isolada gera sinalização; previsões em separadores silenciosos e frases
configuradas como artefatos podem ser removidas com auditoria.

## Arquivos de uma sessão

As sessões ficam em `discordbot/gravacoes/<sessao>/`, ignorado pelo Git.

| Arquivo/pasta | Conteúdo |
| --- | --- |
| `session.json`, `tracks/` | Manifesto e trilhas originais |
| `conversa.txt` | Falas em ordem cronológica, participantes e horários |
| `conversa.json` | Palavras, identidades, timestamps, fontes e sobreposições |
| `transcricao-qualidade.json` | Correções, remoções e trechos suspeitos com motivos |
| `transcricoes/` | Resultados individuais e cache retomável da transcrição |
| `analise-call.json`, `analise-call.md` | Relatório estruturado e versão legível |
| `analise-call/partes/` | Cache dos blocos de análise |

Reexecutar a transcrição reaproveita trechos em cache e remonta a conversa.
A análise valida a compatibilidade do cache com transcrição, modelo, instruções
e contexto local. `--forcar` ignora o cache da etapa solicitada.

## Nomes, grafia e autoria

As configurações locais do bot podem fornecer glossário e correções de grafia.
Correções usam palavras/expressões completas, preservam `raw_text` e são
registradas em `transcricao-qualidade.json`. Alterar as regras e remontar a
transcrição não exige reenviar os trechos já em cache.

`discordbot/config/identidades_discord.json` associa contas às Pessoas da memória:

```json
{
  "creator_person_id": "mem_00000000-0000-4000-8000-000000000000",
  "person_id_by_discord_id": {
    "123456789012345678": "mem_00000000-0000-4000-8000-000000000000"
  }
}
```

Exemplo fictício: substitua pelo ID real de uma Pessoa cadastrada. A associação
usa IDs, não títulos/apelidos ou caminhos. Sem associação, permanece o nome
Discord. `conversa.json` preserva `user_id` como string e inclui `person_id`
quando resolvido. Conhecimento na análise exige evidência atribuída ao criador
configurado, não uma opinião casual de qualquer participante.

## Curadoria e limites

O relatório separa contexto global de evidências de cada observação. A busca
local anexa possíveis correspondências, que são pistas, não evidências da call.
O curador consulta novamente os documentos atuais e distingue informação nova,
complemento, reforço, contradição, duplicata, conteúdo efêmero e ambiguidade.

Uma proposta precisa manter autoria e citações. O modelo não escreve o Markdown
final nem persiste arquivos. Veja [seleção e escrita](memory-writing.md).
Áudio segue para Groq; transcrição e contexto necessário seguem para GLM.
O fluxo de calls não usa o transporte ChatGPT nem a seleção Jev do chat.
