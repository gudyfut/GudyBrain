# Conversa por voz

Voz é um modo de entrada/saída do chat existente. Jev continua selecionando
memória e GPT pela Responses API continua produzindo a resposta.

## Usar

Configure `GEMINI_API_KEY` no `.env` da raiz, reinicie a interface e conceda
permissão de microfone no navegador.

1. Clique no microfone para começar.
2. Clique novamente para terminar a transcrição.
3. Revise o texto reconhecido e envie.
4. Aguarde a busca/resposta; uma mensagem originada do microfone é lida em voz alta.

**Ouvir** reproduz uma resposta concluída; **Parar áudio** interrompe a
reprodução. **Descartar** cancela a captura. Captura de áudio exige um contexto
seguro no navegador, como localhost; a conexão ChatGPT deste aplicativo exige
abrir a interface em `http://127.0.0.1`.

## Fluxo e modelos implementados

| Etapa | Implementação atual |
| --- | --- |
| Transcrição | Gemini Live, `gemini-3.5-transcribe-live` |
| Busca e resposta | Mesmo fluxo do [chat escrito](jev-memory.md) |
| Síntese | Gemini, `gemini-3.8-flash-lite-tts`, voz Charon |

O servidor emite um token temporário limitado à transcrição. A chave principal
não é enviada ao navegador. Áudio capturado segue diretamente para Gemini por
uma conexão Live; o Gudman não o salva em arquivos de gravação.

A síntese roda no servidor e transmite PCM 24 kHz. A reprodução começa com os
primeiros trechos, sem aguardar o áudio inteiro. O servidor aceita somente
texto de uma resposta já registrada na conversa; remove a marcação Markdown
mais comum apenas para a fala.

## Limites e dados enviados

O fluxo é **por turnos**, com revisão da transcrição. Não é uma chamada de áudio
simultânea com interrupção da geração pelo usuário. A síntese só começa após
a resposta ser concluída; tempo de busca e inspeção também afeta a espera.

O TTS recebe a resposta, que pode conter fatos derivados da memória, mas não
recebe os arquivos completos. Confira políticas de dados, disponibilidade dos
modelos e cotas no projeto Google AI Studio. Não há garantia de uso gratuito
ilimitado. Falhas de voz não alteram a memória profunda.

## Diagnosticar

Os comandos de smoke/benchmark estão no [guia de desenvolvimento](desenvolvimento.md)
e fazem chamadas reais. `benchmark:chat` mede busca e geração; `benchmark:voice`
mede conexão, transcrição e início/fim do áudio.

O benchmark de resposta direta com Gemini 3.8 Live é exploratório; se não
produzir uma resposta, um timeout não representa uma medição válida de latência.
Ele não substitui o fluxo de memória implementado.
