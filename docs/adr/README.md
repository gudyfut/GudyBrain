# Registros de decisões arquiteturais

ADRs explicam **por que** uma decisão duradoura foi tomada e quais consequências
foram aceitas. Eles não substituem código, testes, manifests nem guias de uso
como fonte do estado atual. Leia pelo índice somente o ADR pertinente à tarefa.

| ID | Decisão | Estado |
| --- | --- | --- |
| [0001](0001-contexto-sob-demanda.md) | Contexto sob demanda para agentes | Aceita |
| [0002](0002-revisao-humana-da-memoria.md) | Revisão humana antes da escrita de memória | Aceita |
| [0003](0003-modelo-via-responses-api.md) | Acesso ao modelo pela Responses API com plano ChatGPT | Aceita |

Crie um ADR quando uma tarefa escolher ou mudar uma fronteira arquitetural que
futuros contribuidores precisarão entender. Não crie ADR para cada bug, troca de
arquivo, parâmetro, modelo ou ajuste de interface. Use
[o modelo](template.md) e o próximo número disponível. Registre alternativas
consideradas de forma factual, sem transformar preferência passageira em regra.

Quando uma decisão for substituída, preserve o registro original, mude seu
estado para **Substituída por NNNN**, crie o novo ADR e atualize este índice.
Confirme sempre a implementação atual no código antes de aplicar uma decisão
histórica.
