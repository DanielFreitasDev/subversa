//! Tipos públicos trocados entre o backend Rust e o frontend.
//!
//! Todos serializam em `camelCase` para ficarem idiomáticos no TypeScript.

use serde::{Deserialize, Serialize};

/// Nomes das raízes de repositório oficiais do servidor (sob `repo_base`).
/// Usado no default e na semeadura não-destrutiva do `config.rs`.
pub const OFFICIAL_ROOTS: [&str; 8] = [
    "acesso",
    "aplicativos",
    "complac",
    "contabilidade",
    "dividaativa",
    "getranlibs",
    "transacoesweb",
    "veiculo",
];

/// Resultado bruto da execução de um comando `svn`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Dica amigável derivada do código de erro do SVN (E155004, E160013, ...).
    pub hint: Option<String>,
    /// Comando exibido para o usuário (modo "verbose"), ex.: `svn commit -m "..."`.
    pub command: String,
}

/// Detalhes de um conflito para o editor de mesclagem em 3 painéis.
///
/// `kind`: `text` (conteúdo, abre o editor), `tree` (árvore), `property`
/// (propriedade) ou `none`. Para texto, `base`/`mine`/`theirs` trazem o conteúdo
/// das três versões (ancestral comum, minha local, do servidor). Vêm `None` quando
/// o arquivo é binário, grande demais ou ilegível — aí o front cai nas opções rápidas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetails {
    pub path: String,
    pub kind: String,
    pub binary: bool,
    pub base: Option<String>,
    pub mine: Option<String>,
    pub theirs: Option<String>,
    pub base_label: String,
    pub theirs_label: String,
    pub has_tree_conflict: bool,
    pub has_property_conflict: bool,
}

/// Uma entrada do registro de comandos (auditoria do que o app rodou no `svn`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLogEntry {
    /// Sequência monotônica desde o início da sessão (id estável para a UI).
    pub seq: u64,
    /// Momento do término, em epoch milissegundos (UTC). A UI formata em local.
    pub timestamp_ms: u64,
    /// Linha do comando exibida (ex.: `svn commit -m "..."`). Nunca contém senha.
    pub command: String,
    /// O `svn` terminou com sucesso (código 0)?
    pub success: bool,
    /// Código de saída do processo (None se nem chegou a rodar, ou timeout).
    pub code: Option<i32>,
    /// Duração total da execução, em milissegundos.
    pub duration_ms: u64,
}

/// Progresso de uma operação de transferência em andamento (checkout, update,
/// switch, merge, export), emitido via evento `op-progress` conforme o `svn`
/// processa cada arquivo. Não há total conhecido de antemão (o servidor não
/// informa a contagem), então a UI mostra contador + caminho atual em vez de
/// porcentagem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    /// Identificador único desta execução (distingue operações simultâneas).
    pub id: u64,
    /// Qual operação: `"checkout"`, `"update"`, `"switch"`, `"merge"`, `"export"`.
    pub op: String,
    /// Quantos arquivos/diretórios já foram processados até agora.
    pub count: u64,
    /// Caminho mais recente processado (vazio no início e no evento final).
    pub path: String,
    /// `true` no evento final (sucesso ou erro) — a UI usa para remover o cartão.
    pub done: bool,
}

/// Um ponto de restauração (backup) de uma working copy: uma cópia completa da
/// pasta (incluindo o `.svn`) feita antes de uma operação destrutiva, para poder
/// voltar ao estado exato anterior. O `meta.json` ao lado da cópia serializa isto.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    /// Identificador único (também é o nome da pasta do backup em disco).
    pub id: String,
    /// Caminho absoluto da working copy de origem (alvo da restauração).
    pub wc_path: String,
    /// Nome da pasta da working copy (ex.: `sna`).
    pub wc_name: String,
    /// Operação que motivou o backup (ex.: `merge`, `update`, `switch`).
    pub op: String,
    /// URL da working copy no momento do backup.
    pub url: String,
    /// Rótulo legível da linha (ex.: `trunk` ou `ISSUES 2026/...`).
    pub branch_label: String,
    /// Revisão da working copy no momento do backup.
    pub revision: String,
    /// Momento da criação, em epoch milissegundos (UTC). A UI formata em local.
    pub created_ms: u64,
    /// Tamanho total copiado, em bytes.
    pub size_bytes: u64,
    /// Quantidade de arquivos copiados.
    pub file_count: u64,
}

/// Disponibilidade dos binários externos exigidos em tempo de execução.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prerequisites {
    /// `svn` está disponível no PATH.
    pub svn_ok: bool,
    /// `sshpass` está disponível no PATH.
    pub sshpass_ok: bool,
    /// A configuração atual exige `sshpass` (modo senha, ou auto com `$SSHPASS`).
    pub sshpass_needed: bool,
}

/// Onde a working copy está apontando: trunk, branch, tag ou outro.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BranchKind {
    Trunk,
    Branch,
    Tag,
    Other,
}

/// Uma working copy detectada em disco.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingCopy {
    /// Caminho absoluto da raiz da working copy.
    pub path: String,
    /// Nome da pasta (ex.: `sna`).
    pub name: String,
    /// URL completa atual (ex.: `svn+ssh://.../trunk/PROJETOS/sna`).
    pub url: String,
    /// URL relativa à raiz do repositório (ex.: `^/trunk/PROJETOS/sna`).
    pub relative_url: String,
    /// Raiz do repositório.
    pub repo_root: String,
    /// Revisão da working copy (texto, pode conter mixed-rev como "16297:16300M").
    pub revision: String,
    /// Última revisão alterada.
    pub last_changed_rev: Option<String>,
    pub last_changed_author: Option<String>,
    pub last_changed_date: Option<String>,
    /// Tipo de linha onde estamos.
    pub kind: BranchKind,
    /// Rótulo legível da branch (ex.: `trunk` ou `ISSUES 2026/06 - JUNHO/issue_1234`).
    pub branch_label: String,
    /// É a linha principal do projeto (trunk, ou o preset configurado)?
    pub is_mainline: bool,
    /// Quantidade de itens modificados localmente.
    pub modified_count: u32,
    /// Há conflitos pendentes?
    pub has_conflicts: bool,
    /// Chave do projeto-preset correspondente, se houver (ex.: `sna`).
    pub project_key: Option<String>,
    /// UUID do repositório.
    pub uuid: Option<String>,
}

/// Estado de um arquivo/diretório no `svn status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    /// Caminho absoluto.
    pub path: String,
    /// Caminho relativo à raiz da working copy.
    pub rel_path: String,
    /// Estado do conteúdo: modified, added, deleted, unversioned, missing,
    /// conflicted, normal, replaced, ignored, external, incomplete, obstructed.
    pub item: String,
    /// Estado das propriedades: none, modified, conflicted.
    pub props: String,
    /// Foi copiado/movido?
    pub copied: bool,
    /// Está travado por trava de WC?
    pub wc_locked: bool,
    /// Tree-conflict?
    pub tree_conflicted: bool,
    /// Há novidade no servidor para este caminho (status -u)?
    pub remote_modified: bool,
    /// Item remoto (com -u): modified/added/deleted/none.
    pub repos_item: Option<String>,
    pub revision: Option<String>,
    pub is_dir: bool,
}

/// Resultado do `svn status` (possivelmente com -u).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub entries: Vec<StatusEntry>,
    /// Revisão do servidor (apenas quando consultado com -u).
    pub against_revision: Option<String>,
    /// Quantos itens têm novidade no servidor.
    pub incoming_count: u32,
}

/// Caminho alterado dentro de uma revisão (log -v).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPath {
    pub action: String,
    pub path: String,
    pub kind: Option<String>,
    pub copyfrom_path: Option<String>,
    pub copyfrom_rev: Option<String>,
}

/// Uma entrada do histórico (`svn log`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub revision: String,
    pub author: Option<String>,
    pub date: Option<String>,
    pub message: String,
    pub paths: Vec<LogPath>,
}

/// Resultado da aba "Entrada": o que chega do servidor ao atualizar a WC.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingResult {
    /// Revisão atual da working copy (BASE).
    pub base_revision: String,
    /// Revisão HEAD do servidor (None se não foi possível consultar).
    pub head_revision: Option<String>,
    /// Revisões a receber (mais recente → mais antiga); exclui a BASE.
    pub entries: Vec<LogEntry>,
}

/// Entrada de listagem de repositório (`svn list`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    pub name: String,
    /// `file` ou `dir`.
    pub kind: String,
    pub size: Option<u64>,
    pub revision: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
}

/// Uma linha de `svn blame` (autoria por linha).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line_number: u64,
    pub revision: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub content: String,
}

/// Informações de um nó remoto (`svn info URL`), usado pelo navegador de
/// repositórios para mostrar a revisão e validar localizações.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlInfo {
    /// URL completa consultada.
    pub url: String,
    /// Raiz do repositório.
    pub repo_root: String,
    /// URL relativa à raiz (ex.: `^/trunk`).
    pub relative_url: String,
    /// Revisão do nó (HEAD por padrão).
    pub revision: String,
    /// `dir` ou `file`.
    pub kind: String,
    pub last_changed_rev: Option<String>,
    pub last_changed_author: Option<String>,
    pub last_changed_date: Option<String>,
}

/// Projeto pré-configurado (preset do fluxo do usuário).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub key: String,
    pub name: String,
    pub description: String,
    pub url: String,
}

/// Modo de autenticação SSH para `svn+ssh`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SshMode {
    /// Tenta chave; cai para senha (`$SSHPASS`) se disponível.
    Auto,
    /// Somente chave/agent SSH.
    Key,
    /// Força senha via `sshpass -e` (`$SSHPASS`).
    Password,
}

/// Configuração persistida da aplicação.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Pasta-base onde ficam as working copies.
    pub base_dir: String,
    /// Host SSH (ex.: `daniel.souza@172.25.136.61`).
    pub host: String,
    /// URL base do servidor SVN (ex.: `svn+ssh://{host}/usr/svn/`). As raízes
    /// oficiais derivam dela; o host embutido deve casar com `host` para o
    /// ControlMaster reaproveitar o mesmo socket SSH.
    #[serde(default)]
    pub repo_base: String,
    /// Raízes de repositório conhecidas (para o navegador).
    pub repo_roots: Vec<String>,
    /// Projetos-preset.
    pub projects: Vec<Project>,
    pub ssh_mode: SshMode,
    /// Tema da UI: `dark`, `light` ou `system`.
    pub theme: String,
    /// Ferramenta de diff externa preferida (ex.: `meld`).
    pub external_diff_tool: String,
    /// Mostrar o comando svn equivalente em cada operação.
    pub verbose: bool,
    /// Pedir confirmação antes de operações que escrevem no servidor.
    pub confirm_server_ops: bool,
    /// Como oferecer um backup (ponto de restauração) antes de operações
    /// destrutivas: `ask` (pergunta a cada vez), `always` (faz sempre, sem
    /// perguntar) ou `off` (nunca oferece).
    #[serde(default = "default_backup_mode")]
    pub backup_mode: String,
    /// Quantos backups manter por working copy (os mais antigos são removidos).
    /// `0` = ilimitado (nunca remove automaticamente).
    #[serde(default = "default_backup_keep")]
    pub backup_keep: u32,
    /// Pasta-base dos backups. Vazio = `~/.cache/subversa/backups`.
    #[serde(default)]
    pub backup_dir: String,
}

fn default_backup_mode() -> String {
    "ask".into()
}

fn default_backup_keep() -> u32 {
    5
}

impl Default for AppConfig {
    fn default() -> Self {
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        // Default neutro, sem servidor: a primeira execução pede o host e
        // (opcionalmente) semeia raízes/projetos via `AppConfig::seeded_for`.
        AppConfig {
            base_dir: home,
            host: String::new(),
            repo_base: String::new(),
            repo_roots: Vec::new(),
            projects: Vec::new(),
            ssh_mode: SshMode::Auto,
            theme: "dark".into(),
            external_diff_tool: "meld".into(),
            verbose: false,
            confirm_server_ops: true,
            backup_mode: default_backup_mode(),
            backup_keep: default_backup_keep(),
            backup_dir: String::new(),
        }
    }
}

impl AppConfig {
    /// Config semeada a partir de um host SSH (ex.: `usuario@servidor`): deriva a
    /// `repo_base`, as 8 raízes oficiais e os projetos-preset do fluxo da equipe.
    /// Usada pela tela de primeira execução para pré-popular tudo de uma vez.
    pub fn seeded_for(host: &str) -> Self {
        let host = host.trim().to_string();
        let repo_base = format!("svn+ssh://{host}/usr/svn/");
        // Raízes oficiais do servidor (8). As duas usadas pelos presets
        // (`veiculo` e `getranlibs`) saem da mesma base.
        let repo_roots: Vec<String> = OFFICIAL_ROOTS
            .iter()
            .map(|name| format!("{repo_base}{name}"))
            .collect();
        let raiz_veiculo = format!("{repo_base}veiculo");
        let raiz_libs = format!("{repo_base}getranlibs");

        let projects = vec![
            Project {
                key: "sna".into(),
                name: "SNA".into(),
                description: "SNA — trunk".into(),
                url: format!("{raiz_veiculo}/trunk/PROJETOS/sna"),
            },
            Project {
                key: "getran".into(),
                name: "getran 21".into(),
                description: "getran 21 — trunk".into(),
                url: format!("{raiz_veiculo}/trunk/PROJETOS/getran"),
            },
            Project {
                key: "getran160".into(),
                name: "getran 160".into(),
                description: "getran 160 — branch ISSUES 2023".into(),
                url: format!("{raiz_veiculo}/branches/ISSUES 2023/balcaodigital_dev/getran"),
            },
            Project {
                key: "trrenavam".into(),
                name: "trrenavam".into(),
                description: "trrenavam — trunk/MODULOS".into(),
                url: format!("{raiz_veiculo}/trunk/MODULOS/trrenavam"),
            },
            Project {
                key: "sutil".into(),
                name: "sutil 21".into(),
                description: "sutil 21 — trunk".into(),
                url: format!("{raiz_libs}/trunk/sutil"),
            },
            Project {
                key: "sutil160".into(),
                name: "sutil 160".into(),
                description: "sutil 160 — branch ISSUES 2023".into(),
                url: format!("{raiz_libs}/branches/ISSUES 2023/Sprint 01/balcao/sutil"),
            },
        ];

        AppConfig {
            host,
            repo_base,
            repo_roots,
            projects,
            ..AppConfig::default()
        }
    }
}
