# 0003 — Acesso ao modelo pela Responses API

**Estado:** Aceita

**Data:** 2026-09-30

## Contexto

O Gudman orquestra conversa, recuperação Jev, carregamento de documentos e
curadoria. Usava um processo da CLI Codex em cada inspeção e geração para
acessar modelos com o plano ChatGPT. A disponibilidade de Sign in with ChatGPT
para aplicações locais permite que o próprio aplicativo autentique o usuário
e invoque a Responses API pública.

## Decisão

Remover o transporte CLI e usar exclusivamente Responses API para as etapas
que dependiam dele. Separar o contrato de geração do provedor. Preservar as
decisões Jev, limites de leitura, contratos de seleção e revisão humana.

Usar o fluxo oficial OAuth/OIDC com PKCE, consentimento de uso do plano,
registro por conta/workspace e host estável. Credenciais pertencem ao servidor
local e ficam fora do projeto, protegidas por DPAPI no Windows ou permissões
restritas em Unix. Renovação é serializada inclusive entre processos.

O provedor envia contexto explícito, sem ferramentas, com `store: false` e
`stream: true`. Só uma resposta confirmada como concluída entra no histórico.
Falhas não trocam silenciosamente de conta, modelo ou forma de cobrança.

## Alternativas consideradas

- Manter a CLI: reaproveitaria seu login, mas preservaria processos e uma camada
  de agente que estas etapas não precisam.
- Usar API key: permitiria cobrança e limites separados; não atende ao requisito
  de usar a assinatura existente.

## Consequências

- Login e gerenciamento de sessão passam a ser responsabilidade do Gudman.
- A geração pode chegar à interface em fragmentos, mas inspeções sequenciais
  continuam contribuindo para latência e consumo.
- A mudança não concede uma cota própria ao aplicativo. Uso, limites,
  elegibilidade e modelos dependem do plano e da conta autorizada; consulte
  [a configuração atual](../configuracao.md) e a
  [documentação de uso](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
- As restrições deste fluxo não permitem substituir a camada de voz Gemini.

Referências: [registro e login](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[limitações](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
