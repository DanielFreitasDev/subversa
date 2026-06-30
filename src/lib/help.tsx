/**
 * Conteúdo de ajuda (didático, para leigos) de todas as telas e diálogos.
 * Centralizado aqui para manter um tom consistente e facilitar revisões.
 * Cada entrada é um `HelpContent` consumido pelo `HelpPopover` (e pelo Modal
 * via a prop `help`). Mantenha a linguagem simples — explique o "porquê", não
 * só o "o quê" — e em pt-BR, como o resto do app.
 */

import type { HelpContent } from "@/components/ui/HelpPopover";

/** Ajuda dos diálogos e telas, por chave estável. */
export const HELP = {
  // ---- Diálogos -----------------------------------------------------------
  checkout: {
    title: "Baixar projeto (checkout)",
    intro:
      "Faz uma cópia dos arquivos que estão no servidor para uma pasta no seu computador. É assim que você começa a trabalhar em um projeto.",
    points: [
      "“Meus projetos”: escolha um projeto já cadastrado da equipe — é o caminho mais fácil.",
      "“Outra URL”: cole o endereço completo (svn+ssh://…) de qualquer projeto, mesmo fora da lista.",
      "“Baixar em” é a pasta do seu computador onde o projeto vai ficar; “Nome da pasta” é como ela vai se chamar lá dentro.",
    ],
    note: "Você só baixa uma vez. Depois é só atualizar para receber novidades e commitar para enviar as suas.",
  },

  createBranch: {
    title: "Criar branch",
    intro:
      "Uma branch é uma cópia paralela do projeto onde você trabalha sem mexer na versão principal (o trunk). Serve para tocar uma tarefa ou correção com segurança.",
    points: [
      "Dê um nome à tarefa (ex.: issue_1234). O endereço completo é montado sozinho, seguindo o padrão da equipe.",
      "No SVN, criar uma branch é literalmente copiar uma pasta no servidor — é rápido e não atrapalha ninguém.",
      "Com “Trocar para a branch” ligado, sua cópia local passa a trabalhar nela: a partir daí seus commits vão para a branch.",
    ],
    note: "Quando terminar, use a aba Integração para levar o seu trabalho de volta ao trunk.",
  },

  conflict: {
    title: "Resolver conflito",
    intro:
      "Um conflito acontece quando você e outra pessoa mudaram a mesma parte do mesmo arquivo. O SVN não sabe qual versão manter e pede para você decidir.",
    points: [
      "“Marcar como resolvido”: use depois de abrir o arquivo, juntar as partes na mão e deixar do jeito certo.",
      "“Ficar com a minha versão”: mantém o que você escreveu e descarta o que veio do servidor.",
      "“Ficar com a do servidor”: mantém a versão do servidor e descarta as suas mudanças.",
      "Prefere com calma? Abra no programa de comparação (3 painéis) para juntar lado a lado.",
    ],
    note: (
      <>
        No arquivo, as partes em conflito ficam marcadas com{" "}
        <code className="font-mono">{"<<<<<<<"}</code>,{" "}
        <code className="font-mono">{"======="}</code> e{" "}
        <code className="font-mono">{">>>>>>>"}</code>. Apague os marcadores, deixe só o conteúdo
        certo e use “Marcar como resolvido”.
      </>
    ),
  },

  mergeEditor: {
    title: "Editor de conflitos (3 painéis)",
    intro:
      "Mostra lado a lado as três versões do arquivo: a sua (esquerda), o resultado que você está montando (centro, editável) e a do servidor (direita). Você decide, trecho a trecho, com o que ficar.",
    points: [
      "As mudanças que não brigam entre si já entram sozinhas; só os conflitos de verdade (vermelho) precisam de você.",
      "Em cada trecho, use “Meu” ou “Servidor” para escolher um lado, “Ambos” para juntar os dois, ou “Editar” para escrever na mão.",
      "Atalhos: n/p pulam para o próximo/anterior conflito.",
    ],
    note: "“Salvar resolução” só libera quando não sobrar nenhum conflito pendente. Aí o app grava o arquivo e marca como resolvido.",
  },

  repoLocation: {
    title: "Localização de repositório",
    intro:
      "Uma localização é o endereço de um repositório no servidor que você quer poder explorar aqui no app — sem precisar baixá-lo.",
    points: [
      "Digite só o nome (ex.: veiculo) e o app completa com a URL base, ou cole a URL inteira.",
      "Antes de salvar, o app testa o endereço para garantir que ele existe e está acessível.",
    ],
    note: "Isso não baixa nada para o seu computador; é só um atalho para navegar o servidor no Navegador de Repositórios.",
  },

  compare: {
    title: "Comparar com…",
    intro:
      "Mostra as diferenças entre o item selecionado e outro endereço (ou outra versão dele). Útil para ver o que mudou entre duas versões ou dois caminhos.",
    points: [
      "Informe a outra URL para comparar dois caminhos diferentes.",
      "Use URL@REV (ex.: …/projeto@1500) para comparar com uma versão específica.",
    ],
    note: "É só leitura: comparar não altera nada no servidor nem no seu computador.",
  },

  editRevision: {
    title: "Editar comentário da revisão",
    intro:
      "Permite corrigir a mensagem de um commit já enviado (por exemplo, um erro de digitação ou um número de chamado errado).",
    points: [
      "A mudança vale no servidor para todos, na hora — não é um novo commit e não dá para desfazer facilmente.",
      "Só o texto do comentário muda; os arquivos e o histórico da revisão continuam iguais.",
    ],
    note: "Se o servidor recusar, é porque ele não está configurado para aceitar edição de comentários (falta o hook pre-revprop-change). Fale com o administrador do SVN.",
  },

  // ---- Telas (views) ------------------------------------------------------
  overview: {
    title: "Visão geral",
    intro:
      "Mostra todos os projetos que você já baixou para esta pasta de trabalho, com o estado de cada um num relance.",
    points: [
      "Cada cartão é uma cópia local (working copy): mostra se está limpa, com alterações ou com conflitos.",
      "“Atualizar” baixa as novidades do servidor para aquele projeto.",
      "“Conferir servidor” verifica, sem baixar, se há novidades esperando em cada projeto.",
      "“Baixar” traz um projeto novo do servidor para esta pasta.",
    ],
    note: "Não vê seu projeto? Troque a pasta de trabalho na barra lateral ou baixe-o.",
  },

  changes: {
    title: "Alterações e commit",
    intro:
      "Mostra tudo o que você mudou na sua cópia local e ainda não enviou. É daqui que você publica o seu trabalho no servidor.",
    points: [
      "Marque os arquivos que quer enviar, escreva uma mensagem explicando a mudança e clique em Commitar.",
      "No SVN, commitar já envia para o servidor na hora — não existe um “push” separado.",
      "Clique em um arquivo para ver, ao lado, exatamente o que mudou (o diff).",
      "“Reverter” descarta as mudanças locais, voltando ao que estava antes: use o ícone (ou o botão direito do mouse) no arquivo, “Reverter selecionados” para os marcados, ou “Reverter tudo” para toda a working copy.",
    ],
    note: "Letras: M = modificado, A = novo, D = apagado, C = conflito. Conflitos precisam ser resolvidos antes de commitar.",
  },

  incoming: {
    title: "Entrada (a receber)",
    intro:
      "Mostra o que mudou no servidor desde a última vez que você atualizou — ou seja, o que vai chegar na sua cópia local quando você clicar em Atualizar.",
    points: [
      "Cada item é uma revisão a receber: quem mudou, quando, a mensagem e os arquivos — clique para ver o diff de cada uma.",
      "O cabeçalho mostra em que revisão você está e em qual o servidor está.",
      "“Atualizar agora” baixa tudo isso de uma vez para a sua cópia local.",
    ],
    note: "É só uma prévia: nada muda na sua cópia até você atualizar. Se aparecer “Tudo em dia”, você já tem a versão mais recente.",
  },

  history: {
    title: "Histórico",
    intro:
      "Mostra a linha do tempo do projeto: cada alteração já enviada ao servidor (revisão), com autor, data e a mensagem do commit.",
    points: [
      "Clique em uma revisão para ver o que mudou nela.",
      "Use a busca para filtrar por autor ou por um termo na mensagem.",
      "Clique com o botão direito numa revisão (ou use os ícones no detalhe) para reverter as mudanças dela, editar o comentário ou copiar o número.",
      "“Carregar mais” mostra revisões mais antigas.",
    ],
    note: "Olhar o histórico não muda nada; reverter aplica as mudanças na sua cópia para você revisar e commitar, e editar o comentário altera a mensagem no servidor.",
  },

  branches: {
    title: "Branches e troca de linha",
    intro:
      "Aqui você navega as linhas do projeto no servidor — o trunk (versão principal), as branches (trabalhos paralelos) e as tags — e escolhe em qual delas a sua cópia local vai trabalhar.",
    points: [
      "Trunk é a linha oficial; branch é uma cópia para trabalhar sem atrapalhar o trunk.",
      "Trocar (switch) aponta a sua cópia local para outra linha, sem baixar tudo de novo.",
      "“Criar branch” abre uma nova linha de trabalho a partir de onde você está.",
    ],
    note: "Apagar uma linha a remove do servidor para todos — é permanente. Cuidado, principalmente se for a linha onde você está.",
    noteTone: "warn",
  },

  repos: {
    title: "Navegador de repositórios",
    intro:
      "Permite explorar o conteúdo dos repositórios direto no servidor, como um gerenciador de arquivos — sem precisar baixar o projeto.",
    points: [
      "À esquerda ficam as localizações (repositórios) cadastradas; no meio, a árvore de pastas e arquivos.",
      "Selecione um item e use os botões da barra para agir sobre ele (criar pasta, mover, criar branch/tag, comparar, ver histórico, exportar…).",
      "Expandir tudo / Recolher tudo: abra ou feche a árvore inteira de uma vez (botões da barra de busca) ou só de uma pasta (menu do botão direito).",
      "Busca: por Nome filtra arquivos e pastas instantaneamente; por Conteúdo procura dentro dos arquivos. Ambas valem para a pasta selecionada (mostrada à direita da busca).",
      "Botão apagado? Passe o mouse para ver por que ele não se aplica ao item selecionado.",
    ],
    note: "A busca por conteúdo baixa cada arquivo do servidor — em pastas grandes pode demorar; prefira buscar dentro de uma subpasta.",
  },

  backups: {
    title: "Backups (pontos de restauração)",
    intro:
      "Antes de operações que podem bagunçar sua cópia local (merge, atualizar, trocar de linha, reverter), o app pode tirar uma cópia completa da pasta. Se algo der errado, você restaura e volta exatamente ao estado anterior — como se a operação nunca tivesse acontecido.",
    points: [
      "Cada backup é uma cópia fiel da working copy (inclusive o controle do SVN) feita naquele instante.",
      "“Restaurar” sobrescreve a cópia local atual com a do backup — tudo o que você fez depois é descartado.",
      "“Excluir” remove o backup do disco para liberar espaço.",
      "Por padrão, o app guarda os 5 backups mais recentes de cada projeto e apaga os mais antigos.",
    ],
    note: "Restaurar reescreve a pasta inteira; por isso pede que você digite o nome do projeto para confirmar.",
    noteTone: "warn",
  },

  // ---- Configurações ------------------------------------------------------
  settingsAuth: {
    title: "Servidor & autenticação",
    intro:
      "Define a qual servidor o app se conecta e como ele prova quem é você ao acessar o SVN.",
    points: [
      "Host SSH: o seu usuário e o endereço do servidor, no formato usuario@servidor.",
      "Autenticação — “Chave”: usa sua chave SSH (sem senha). “Senha”: usa a senha do ambiente. “Auto”: tenta a chave e cai para a senha se preciso.",
      "“Testar conexão” confirma que o servidor responde.",
    ],
  },

  settingsLocations: {
    title: "Localizações de repositório",
    intro: "São os repositórios que aparecem para explorar no Navegador de Repositórios.",
    points: [
      "“URL base” é o começo comum dos endereços; com ela, você cadastra uma localização digitando só o nome curto (ex.: veiculo).",
      "Você também pode cadastrar uma URL completa.",
    ],
    note: "Cadastrar uma localização não baixa nada — é só um atalho de navegação.",
  },

  settingsProjects: {
    title: "Meus projetos",
    intro:
      "São atalhos para os projetos da equipe. Aparecem na tela de “Baixar projeto” e ajudam o app a reconhecer qual é a linha principal de cada um.",
    points: [
      "Cada projeto tem um id, um nome, uma descrição e a URL no servidor.",
      "Reconhecer a linha principal é o que faz os botões de sincronizar/publicar (aba Integração) funcionarem certo.",
    ],
  },

  settingsPreferences: {
    title: "Preferências",
    intro: "Ajustes de comportamento do app.",
    points: [
      "“Confirmar operações no servidor”: pede confirmação antes de ações que mudam o servidor (commit, merge, switch…). Recomendado deixar ligado.",
      "“Modo verboso”: mostra o comando svn equivalente a cada ação — útil para aprender ou conferir.",
      "“Ferramenta de diff externa”: o programa aberto para comparar/resolver arquivos (ex.: meld, kdiff3).",
    ],
  },

  settingsBackups: {
    title: "Pontos de restauração (backup)",
    intro:
      "Controla se o app oferece um backup da sua cópia local antes de operações destrutivas (merge, atualizar, trocar de linha, reverter).",
    points: [
      "“Perguntar a cada vez”: antes de cada operação, você escolhe se quer o backup. (Recomendado.)",
      "“Sempre”: cria o backup automaticamente, sem perguntar.",
      "“Desligado”: nunca oferece backup.",
      "“Quantos manter”: backups antigos além desse número são apagados sozinhos (0 = manter todos).",
      "“Pasta”: onde os backups ficam. Vazio = uma pasta de cache do sistema.",
    ],
    note: "Cada backup é uma cópia completa da pasta — pode ocupar bastante disco em projetos grandes.",
  },

  setupHost: {
    title: "Qual servidor informar?",
    intro:
      "É o endereço do servidor SVN da sua equipe, junto com o seu usuário, no formato usuario@servidor.",
    points: [
      "Exemplo: ana@172.25.136.61.",
      "“Continuar com meus projetos padrão” já cadastra os repositórios e projetos da equipe a partir desse host.",
      "“Começar vazio” cria só a conexão; você adiciona as localizações depois.",
    ],
    note: "Sem certeza? Peça ao responsável pelo SVN o endereço do servidor e o seu usuário.",
  },

  // ---- Layout / globais ---------------------------------------------------
  sidebar: {
    title: "Projetos e pasta de trabalho",
    intro:
      "A barra lateral lista as cópias locais (working copies) dentro da sua pasta de trabalho — a pasta do seu computador onde os projetos baixados ficam.",
    points: [
      "Clique em um projeto para abri-lo e ver suas alterações.",
      "O indicador à direita: ● verde = sem mudanças; número âmbar = arquivos alterados; ⚠ = conflitos.",
      "Os ícones ao lado de “Projetos” trocam a pasta de trabalho, a fecham ou recarregam a lista.",
    ],
    note: "Trunk (verde) é a linha principal; branch (roxo) é uma linha de trabalho paralela.",
  },

  commandLog: {
    title: "Registro de comandos",
    intro:
      "Mostra, em tempo real, todo comando svn que o app executa por baixo dos panos — com horário, resultado (OK/ERRO) e duração.",
    points: [
      "Serve para auditar o que o app fez ou investigar um erro.",
      "Linhas em vermelho são comandos que falharam.",
      "“Abrir arquivo” mostra o log gravado em disco; “Limpar” esvazia a lista.",
    ],
    note: "Você não precisa olhar aqui no dia a dia — é uma ferramenta de transparência e diagnóstico.",
  },

  commandPalette: {
    title: "Paleta de comandos",
    intro:
      "Um buscador rápido de tudo o que o app faz. Em vez de procurar o botão, você digita o que quer.",
    points: [
      "Abra a qualquer momento com Ctrl+K (⌘K no Mac).",
      "Digite parte do nome (ex.: “commit”, “branch”, “atualizar”) e tecle Enter.",
      "As setas ↑ ↓ navegam pela lista; Esc fecha.",
    ],
  },

  diff: {
    title: "Entendendo o diff",
    intro:
      "“Diff” é a comparação que mostra exatamente o que mudou em um arquivo: linhas adicionadas, removidas ou alteradas.",
    points: [
      "Verde (+) é o que foi adicionado; vermelho (−) é o que foi removido.",
      "“Unificado” mostra tudo numa coluna; “Lado a lado” põe antes/depois em duas colunas.",
      "“Ignorar espaços” esconde diferenças só de espaçamento/indentação.",
    ],
    note: "Atalhos: n/p pulam entre mudanças; [ e ] pulam entre arquivos.",
  },

  statusBar: {
    title: "Barra de status",
    intro: "A faixa de baixo mostra, num relance, o contexto atual do app.",
    points: [
      "À esquerda: a versão do svn instalado e o servidor (host) conectado.",
      "À direita (com um projeto aberto): a pasta da cópia local, a revisão atual (rN) e a última alteração.",
    ],
  },
} satisfies Record<string, HelpContent>;

/** Ajuda do diálogo de operações de repositório, por tipo de operação. */
export const REPO_OP_HELP: Record<string, HelpContent> = {
  mkdir: {
    title: "Nova pasta remota",
    intro:
      "Cria uma pasta diretamente no servidor, dentro da pasta atual. Ela passa a existir para todo mundo.",
    points: [
      "Use / no nome para criar várias pastas de uma vez (ex.: docs/imagens).",
      "Como mexe no servidor, é registrado como um commit — por isso pede uma mensagem.",
    ],
  },
  move: {
    title: "Mover ou renomear",
    intro:
      "Muda o endereço de um item no servidor. Renomear é mudar só o final do caminho; mover é mudar a pasta onde ele fica.",
    points: [
      "O destino precisa ficar no mesmo repositório.",
      "O histórico é preservado: o item continua com todo o seu passado, só em outro lugar.",
    ],
    note: "É uma operação no servidor (vira um commit) e vale para todos.",
  },
  branchTag: {
    title: "Criar branch ou tag",
    intro:
      "Cria uma cópia do item no servidor. Branch é uma linha de trabalho paralela; tag é uma “foto” de um momento, que não deve mais ser alterada.",
    points: [
      "Branch: para desenvolver uma tarefa sem mexer no trunk.",
      "Tag: para marcar um ponto importante (ex.: uma versão entregue).",
      "O endereço segue o padrão da equipe automaticamente — dá para editar à mão se precisar.",
    ],
  },
  import: {
    title: "Importar pasta",
    intro:
      "Envia uma pasta do seu computador para dentro do servidor, criando os itens lá pela primeira vez.",
    points: [
      "Escolha a pasta local e o nome que ela terá no servidor.",
      "Serve para colocar no SVN algo que ainda não está versionado.",
    ],
    note: "Importar não transforma a sua pasta local em cópia de trabalho — para isso, baixe (checkout) o projeto depois.",
  },
  export: {
    title: "Exportar",
    intro:
      "Baixa uma cópia “limpa” dos arquivos, sem as informações de controle do SVN (a pasta .svn).",
    points: [
      "Diferente do checkout: o resultado não fica ligado ao servidor — não dá para commitar nem atualizar.",
      "Bom para entregar/empacotar os arquivos para quem não usa SVN.",
      "“Forçar” permite gravar mesmo se a pasta de destino já tiver conteúdo.",
    ],
  },
};

/** Histórico remoto: muda conforme seja "Histórico" simples ou "Navegar alterações". */
export function repoHistoryHelp(browse: boolean): HelpContent {
  if (browse) {
    return {
      title: "Navegar alterações",
      intro: "É o histórico com filtros, para encontrar uma alteração específica entre muitas.",
      points: [
        "Busca: filtra por autor ou por um termo na mensagem do commit.",
        "Intervalo: limita por número de revisão (1000:2000) ou por data ({2026-01-01}:{2026-06-30}).",
      ],
      note: "É só leitura — nada é alterado.",
    };
  }
  return {
    title: "Histórico",
    intro:
      "Lista todas as alterações (revisões) já feitas neste item ao longo do tempo: quem mudou, quando e a mensagem do commit.",
    points: [
      "Clique em uma revisão para ver exatamente o que mudou nela.",
      "Cada commit no SVN vira uma revisão com um número (ex.: r1500).",
    ],
    note: "É só leitura — serve para entender o passado do projeto.",
  };
}

/** Ajuda dos cartões da aba Integração (merge). */
export const MERGE_HELP = {
  sync: {
    title: "Receber a linha principal (sync)",
    intro:
      "Traz para a sua branch tudo o que mudou no trunk desde que você a criou. Assim sua branch fica em dia com o resto da equipe.",
    points: [
      "Faça isso de tempos em tempos — e principalmente antes de publicar.",
      "“Pré-visualizar” mostra o que viria, sem aplicar nada.",
      "“Receber e commitar” aplica as mudanças na sua branch e já registra o merge.",
    ],
    note: "Se aparecerem conflitos, o app leva você para a aba Alterações para resolver.",
  },
  publish: {
    title: "Publicar na linha principal (reintegrar)",
    intro:
      "Leva o trabalho concluído da sua branch de volta para o trunk, para que vire a versão oficial que todos usam.",
    points: [
      "O app troca sua cópia para o trunk, atualiza e mescla a sua branch nele.",
      "No fim, você revisa tudo na aba Alterações e faz o commit — esse commit é a publicação.",
      "Receba a linha principal (sync) antes, para reduzir conflitos.",
    ],
    note: "Nada é publicado automaticamente: você confere e só então confirma o commit.",
  },
  reintegrate: {
    title: "Reintegrar uma branch no trunk",
    intro:
      "Sua cópia já está na linha principal. Aqui você escolhe qual branch quer trazer (mesclar) para dentro dela.",
    points: [
      "Informe o endereço da branch a mesclar.",
      "“Pré-visualizar” mostra o que viria, sem aplicar.",
      "Depois de mesclar, revise e commite na aba Alterações para publicar.",
    ],
  },
} satisfies Record<string, HelpContent>;
