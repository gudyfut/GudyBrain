# Roadmap de implementação

## Estado atual

- cliente GLM com streaming e function calling;
- Gudman conversante com memória de curto prazo e consulta ao bundle;
- memória Markdown estruturada com leitura, busca filtrada e escrita validada;
- curadores independentes de chat e call que propõem Pessoas, Grupos, Lugares,
  Conhecimentos, Eventos e Projetos;
- preenchedor determinístico que preserva e valida a estrutura dos documentos;
- revisão humana na interface web antes de criar, atualizar ou renomear;
- bot de Discord separado para gravação por participante e transcrição.
- analista de call com extração em blocos, consolidação por tipo e classificação
  local em Alto, Médio e Baixo potencial de memória antes do handoff ao curador.

## Próximos passos

### Evolução da análise de calls

- medir qualidade das observações e ajustar os limiares por tipo;
- permitir correções humanas no relatório antes da curadoria;
- manter métricas de custo, duração e reaproveitamento de cache.

### Inteligência temporal e lembretes

- calcular idade a partir de `data_nascimento`, sem persistir idade;
- consultar aniversários e eventos próximos;
- representar recorrência separadamente de um Evento concreto;
- manter rotinas temporais externas ao chat e o bundle como fonte canônica.

### Recuperação semântica

Adicionar embeddings ou outro índice somente quando busca textual, filtros e
links deixarem de atender. A recuperação deve continuar progressiva e limitar o
volume de memória enviado a cada agente.

### Qualidade e privacidade

- ampliar testes locais de schemas, filtros e escrita;
- definir política para separar código público de memória pessoal privada;
- registrar origem e confiança de transcrições importadas;
- medir custo e perda de contexto antes de introduzir qualquer agente novo.

As decisões sobre separação de agentes estão em
[arquitetura-agentes.md](arquitetura-agentes.md).
