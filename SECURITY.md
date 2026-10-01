# Segurança e privacidade

O GudyBrain é uma aplicação **local, para um único usuário**. Os scripts web
escutam em `127.0.0.1`; as APIs rejeitam hosts externos e solicitações de outros
sites. Não publique esse servidor em um domínio ou túnel: ele não oferece
autenticação multiusuário nem isolamento entre contas.

- `.env`, suas variantes, memórias, gravações e configurações pessoais não
  devem ser versionados. `.env.example` contém somente campos de exemplo.
- Os arquivos ficam locais, mas os provedores de IA recebem o contexto
  necessário às operações solicitadas. Revise o material antes de compartilhar.
- Novas memórias exigem revisão humana. A escrita valida o contrato, caminhos
  e revisão-base; links simbólicos no acervo são rejeitados.
- As credenciais ChatGPT são armazenadas fora do projeto, protegidas por
  DPAPI no Windows e permissões restritas em outros sistemas.
- Mantenha as dependências atualizadas e execute `npm audit` e `npm test`
  antes de disponibilizar uma versão.

Se uma credencial foi publicada, revogue-a e substitua-a. Remover o arquivo
ou a branch não basta: commits antigos podem continuar disponíveis por hash,
em clones, forks e caches. Siga o
[procedimento do GitHub para remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

Ao reportar uma falha, não publique tokens, documentos pessoais, transcrições
ou capturas que contenham esses dados. Descreva o problema com exemplos
fictícios e passos mínimos de reprodução.
