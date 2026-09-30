# Roadmap

As propostas abaixo são possibilidades de evolução, não funcionalidades
entregues nem compromissos de prazo. O estado atual está na
[visão do projeto](projeto.md) e nos [guias](README.md).

## Recuperação e curadoria

- Calibrar limiares Jev com perguntas e conversas rotuladas.
- Medir fatos úteis perdidos, identidade incorreta, duplicatas e contradições.
- Melhorar recuperação de referências ambíguas mantendo contexto compacto.
- Avaliar índices semânticos somente quando descrições, busca textual e links
  forem insuficientes.

## Voz e desempenho

- Medir separadamente conexão, transcrição, busca, inspeção, resposta e síntese.
- Reduzir chamadas sequenciais sem perder acesso integral aos documentos.
- Avaliar conversa de áudio contínua e interrupções sem contornar a memória
  ou a revisão humana existentes.

## Calls

- Melhorar correções humanas de autoria e evidências antes da curadoria.
- Medir qualidade das observações por tipo e contexto da chamada.
- Acompanhar duração, custo e reaproveitamento do cache.

## Memória e operação

- Ampliar consultas temporais, recorrência e lembretes.
- Melhorar backup/restauração de acervos privados.
- Avaliar recuperação de operações que renomeiam múltiplos arquivos.
- Manter privacidade e limites explícitos à medida que o acervo cresce.

Mudanças de fronteiras arquiteturais devem ser registradas em
[ADRs](adr/README.md); mudanças complexas podem usar
[especificações](spec-driven-development.md).
