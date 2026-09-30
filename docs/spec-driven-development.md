# Desenvolvimento guiado por especificações

Este fluxo aplica as ideias centrais do [Spec Kit para projetos existentes](https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md)
ao GudyBrain. Não depende da CLI `specify`: os arquivos em `specs/` são modelos
Markdown mantidos pelo projeto, e nenhum comando `/speckit.*` foi instalado.

## Quando usar

Use `specs/<ano-mes>-<tema>/` quando os requisitos forem ambíguos, a mudança
atravessar várias áreas ou houver critérios de aceite que precisam ser
acompanhados ao longo de várias etapas. Para trabalho localizado, registre
objetivo e verificação na tarefa/PR, sem criar artefatos por obrigação.

Uma especificação descreve **a mudança desejada**. Não tente reconstruir todo o
projeto retrospectivamente. Use `README.md`, os documentos em `docs/`, os arquivos
de entrada indicados por `AGENTS.md` e o código atual como contexto. Os dados
pessoais em `memory/` e `discordbot/gravacoes/` não são material de inventário.

## Ciclo

1. **Especificar:** copie `specs/_template/spec.md`. Declare problema,
   comportamento observável, requisitos numerados, critérios de aceite,
   restrições e dúvidas. Resolva dúvidas que mudem o resultado antes do plano.
2. **Planejar:** copie `plan.md`. Localize os contratos existentes, escolha o
   menor conjunto de mudanças, registre migração/compatibilidade quando
   pertinente e associe cada requisito à solução e à validação.
3. **Decompor:** copie `tasks.md`. Ordene tarefas por dependência e associe-as aos
   requisitos. Uma tarefa deve ter resultado conferível.
4. **Conferir antes de codar:** procure contradições entre `spec.md`, `plan.md`,
   tarefas, código e `AGENTS.md`. Corrija o artefato que
   possui a decisão; não replique instruções em vários lugares.
5. **Implementar e verificar:** atualize as caixas em `tasks.md` conforme as
   etapas terminem. Escolha a validação pelos scripts e testes da área e
   registre resultado e limitações.
6. **Convergir:** compare a implementação com todos os critérios de aceite.
   Adicione tarefas faltantes e repita até que não haja lacunas conhecidas.
   Marque o estado da especificação como `concluída` quando o resultado for
   entregue.

Para mudanças grandes ou ambíguas, faça uma revisão explícita dos requisitos
antes da implementação. Uma checklist de qualidade de requisitos, se criada,
registra decisões de revisão; caixas marcadas nas tarefas representam trabalho
executado. Consulte o [fluxo oficial do Spec Kit](https://github.github.com/spec-kit/reference/agentic-sdd.html)
para as etapas opcionais de esclarecer, analisar e convergir.

## Autoridade e evolução

- Durante a implementação, `spec.md` define o comportamento pretendido;
  `plan.md` registra como alcançá-lo e `tasks.md` acompanha execução. Descobertas
  que mudem requisitos devem voltar ao `spec.md` antes de alterar o plano.
- Depois da entrega, código e testes demonstram o estado vigente. Guias de uso
  precisam estar corretos onde se aplicam. A especificação concluída permanece
  como registro da mudança.
  Uma exigência posterior ganha novo diretório e link para a especificação
  anterior, conforme o modelo histórico descrito pelo
  [Spec Kit](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md).
- Decisões arquiteturais duradouras e suas justificativas pertencem a
  [ADRs](adr/README.md). Uma especificação registra o objetivo de uma mudança;
  ela não substitui um ADR quando uma escolha de arquitetura precisa sobreviver
  ao fim daquela mudança.
- Não coloque prompts, nomes de pessoas, trechos de transcrições, chaves ou
  conteúdo de memórias pessoais nas especificações. Use exemplos sintéticos.
O [guia oficial de `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
descreve instruções por diretório. A [orientação da OpenAI sobre contexto](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
recomenda manter o arquivo raiz enxuto e carregar documentação conforme a tarefa.
