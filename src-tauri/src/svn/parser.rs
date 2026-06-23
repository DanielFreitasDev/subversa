//! Parsing das saídas `--xml` do Subversion.
//!
//! Preferimos XML em vez do texto humano porque ele é estável entre versões e
//! independente do idioma (a CLI do usuário fala português). As estruturas
//! `*Xml` abaixo espelham exatamente o schema do `svn`.

use serde::Deserialize;

use super::types::{BlameLine, ListEntry, LogEntry, LogPath, StatusEntry, StatusResult};

// ---------------------------------------------------------------------------
// svn info --xml
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct InfoXml {
    #[serde(rename = "entry", default)]
    pub entries: Vec<InfoEntry>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // alguns campos espelham o schema XML mas não são usados ainda
pub struct InfoEntry {
    #[serde(rename = "@kind")]
    pub kind: String,
    #[serde(rename = "@path")]
    pub path: String,
    #[serde(rename = "@revision")]
    pub revision: String,
    pub url: Option<String>,
    #[serde(rename = "relative-url")]
    pub relative_url: Option<String>,
    pub repository: Option<Repository>,
    #[serde(rename = "wc-info")]
    pub wc_info: Option<WcInfo>,
    pub commit: Option<CommitXml>,
}

#[derive(Debug, Deserialize)]
pub struct Repository {
    pub root: Option<String>,
    pub uuid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // metadados da WC, mantidos por completude do schema
pub struct WcInfo {
    #[serde(rename = "wcroot-abspath")]
    pub wcroot_abspath: Option<String>,
    pub schedule: Option<String>,
    pub depth: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CommitXml {
    #[serde(rename = "@revision")]
    pub revision: String,
    pub author: Option<String>,
    pub date: Option<String>,
}

pub fn parse_info(xml: &str) -> Result<InfoXml, String> {
    quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler info: {e}"))
}

// ---------------------------------------------------------------------------
// svn status --xml [-u]
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct StatusXml {
    #[serde(rename = "target", default)]
    targets: Vec<StatusTarget>,
}

#[derive(Debug, Deserialize)]
struct StatusTarget {
    #[serde(rename = "entry", default)]
    entries: Vec<StatusEntryXml>,
    against: Option<Against>,
}

#[derive(Debug, Deserialize)]
struct Against {
    #[serde(rename = "@revision")]
    revision: String,
}

#[derive(Debug, Deserialize)]
struct StatusEntryXml {
    #[serde(rename = "@path")]
    path: String,
    #[serde(rename = "wc-status")]
    wc_status: WcStatusXml,
    #[serde(rename = "repos-status")]
    repos_status: Option<ReposStatusXml>,
}

#[derive(Debug, Deserialize)]
struct WcStatusXml {
    #[serde(rename = "@item")]
    item: String,
    #[serde(rename = "@props")]
    props: String,
    #[serde(rename = "@revision")]
    revision: Option<String>,
    #[serde(rename = "@copied")]
    copied: Option<String>,
    #[serde(rename = "@wc-locked")]
    wc_locked: Option<String>,
    #[serde(rename = "@tree-conflicted")]
    tree_conflicted: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReposStatusXml {
    #[serde(rename = "@item")]
    item: String,
}

/// Converte a saída do status. `root` é a raiz da working copy para calcular
/// caminhos relativos; `is_dir` é resolvido pelo chamador (sistema de arquivos).
pub fn parse_status(
    xml: &str,
    root: &std::path::Path,
    dir_check: impl Fn(&std::path::Path) -> bool,
) -> Result<StatusResult, String> {
    let parsed: StatusXml =
        quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler status: {e}"))?;

    let mut entries: Vec<StatusEntry> = Vec::new();
    let mut against_revision: Option<String> = None;
    let mut incoming_count: u32 = 0;

    for target in parsed.targets {
        if let Some(against) = target.against {
            against_revision = Some(against.revision);
        }
        for e in target.entries {
            let abs = std::path::Path::new(&e.path);
            let rel = abs
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| e.path.clone());
            let rel = if rel.is_empty() { ".".to_string() } else { rel };

            let repos_item = e.repos_status.as_ref().map(|r| r.item.clone());
            let remote_modified = repos_item
                .as_deref()
                .map(|i| i != "none")
                .unwrap_or(false);
            if remote_modified {
                incoming_count += 1;
            }

            entries.push(StatusEntry {
                rel_path: rel,
                is_dir: dir_check(abs),
                path: e.path,
                item: e.wc_status.item,
                props: e.wc_status.props,
                copied: e.wc_status.copied.as_deref() == Some("true"),
                wc_locked: e.wc_status.wc_locked.as_deref() == Some("true"),
                tree_conflicted: e.wc_status.tree_conflicted.as_deref() == Some("true"),
                remote_modified,
                repos_item,
                revision: e.wc_status.revision,
            });
        }
    }

    // ordena: conflitos primeiro, depois por caminho.
    entries.sort_by(|a, b| {
        let rank = |e: &StatusEntry| match e.item.as_str() {
            "conflicted" => 0,
            "missing" | "obstructed" => 1,
            "modified" | "added" | "deleted" | "replaced" => 2,
            "unversioned" => 3,
            _ => 4,
        };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });

    Ok(StatusResult {
        entries,
        against_revision,
        incoming_count,
    })
}

// ---------------------------------------------------------------------------
// svn log --xml -v
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct LogXml {
    #[serde(rename = "logentry", default)]
    entries: Vec<LogEntryXml>,
}

#[derive(Debug, Deserialize)]
struct LogEntryXml {
    #[serde(rename = "@revision")]
    revision: String,
    author: Option<String>,
    date: Option<String>,
    msg: Option<String>,
    paths: Option<LogPathsXml>,
}

#[derive(Debug, Deserialize)]
struct LogPathsXml {
    #[serde(rename = "path", default)]
    paths: Vec<LogPathXml>,
}

#[derive(Debug, Deserialize)]
struct LogPathXml {
    #[serde(rename = "@action")]
    action: String,
    #[serde(rename = "@kind")]
    kind: Option<String>,
    #[serde(rename = "@copyfrom-path")]
    copyfrom_path: Option<String>,
    #[serde(rename = "@copyfrom-rev")]
    copyfrom_rev: Option<String>,
    #[serde(rename = "$text")]
    path: Option<String>,
}

pub fn parse_log(xml: &str) -> Result<Vec<LogEntry>, String> {
    let parsed: LogXml =
        quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler log: {e}"))?;
    Ok(parsed
        .entries
        .into_iter()
        .map(|e| LogEntry {
            revision: e.revision,
            author: e.author,
            date: e.date,
            message: e.msg.unwrap_or_default(),
            paths: e
                .paths
                .map(|p| {
                    p.paths
                        .into_iter()
                        .map(|x| LogPath {
                            action: x.action,
                            path: x.path.unwrap_or_default(),
                            kind: x.kind,
                            copyfrom_path: x.copyfrom_path,
                            copyfrom_rev: x.copyfrom_rev,
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// svn list --xml
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ListsXml {
    #[serde(rename = "list", default)]
    lists: Vec<ListXml>,
}

#[derive(Debug, Deserialize)]
struct ListXml {
    #[serde(rename = "entry", default)]
    entries: Vec<ListEntryXml>,
}

#[derive(Debug, Deserialize)]
struct ListEntryXml {
    #[serde(rename = "@kind")]
    kind: String,
    name: String,
    size: Option<u64>,
    commit: Option<CommitXml>,
}

pub fn parse_list(xml: &str) -> Result<Vec<ListEntry>, String> {
    let parsed: ListsXml =
        quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler list: {e}"))?;
    let mut out: Vec<ListEntry> = Vec::new();
    for list in parsed.lists {
        for e in list.entries {
            out.push(ListEntry {
                name: e.name,
                kind: e.kind,
                size: e.size,
                revision: e.commit.as_ref().map(|c| c.revision.clone()),
                author: e.commit.as_ref().and_then(|c| c.author.clone()),
                date: e.commit.as_ref().and_then(|c| c.date.clone()),
            });
        }
    }
    // diretórios primeiro, depois ordem alfabética.
    out.sort_by(|a, b| {
        let da = (a.kind != "dir") as u8;
        let db = (b.kind != "dir") as u8;
        da.cmp(&db).then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

// ---------------------------------------------------------------------------
// svn blame --xml  (metadados por linha; o conteúdo vem do `svn cat`)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct BlameXml {
    #[serde(rename = "target", default)]
    targets: Vec<BlameTargetXml>,
}

#[derive(Debug, Deserialize)]
struct BlameTargetXml {
    #[serde(rename = "entry", default)]
    entries: Vec<BlameEntryXml>,
}

#[derive(Debug, Deserialize)]
struct BlameEntryXml {
    #[serde(rename = "@line-number")]
    line_number: u64,
    commit: Option<CommitXml>,
}

/// Combina os metadados de `svn blame --xml` com as linhas de conteúdo
/// obtidas por `svn cat`.
pub fn parse_blame(xml: &str, content: &str) -> Result<Vec<BlameLine>, String> {
    let parsed: BlameXml =
        quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler blame: {e}"))?;
    let lines: Vec<&str> = content.lines().collect();
    let mut out: Vec<BlameLine> = Vec::new();
    for target in parsed.targets {
        for e in target.entries {
            let idx = (e.line_number as usize).saturating_sub(1);
            out.push(BlameLine {
                line_number: e.line_number,
                revision: e.commit.as_ref().map(|c| c.revision.clone()),
                author: e.commit.as_ref().and_then(|c| c.author.clone()),
                date: e.commit.as_ref().and_then(|c| c.date.clone()),
                content: lines.get(idx).map(|s| s.to_string()).unwrap_or_default(),
            });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Dicas amigáveis a partir do código de erro do SVN.
// ---------------------------------------------------------------------------

/// Espelha o mapeamento de erros do `fluxo_svn.sh` (`mostrar_erro_svn`).
pub fn hint_from_stderr(stderr: &str) -> Option<String> {
    let s = stderr;
    if s.contains("E155004") {
        Some("Working copy travada — rode \"Limpar (cleanup)\" para destravar.".into())
    } else if s.contains("E170013")
        || s.contains("E210002")
        || s.contains("E670002")
        || s.contains("E730054")
    {
        Some("Falha de conexão — verifique a rede/VPN e o acesso SSH ao servidor.".into())
    } else if s.contains("E155015") || s.contains("E195020") {
        Some("Conflito pendente — resolva os arquivos marcados e marque como resolvido.".into())
    } else if s.contains("E160013") {
        Some("Caminho não existe no servidor — confira a URL (use o navegador de branches).".into())
    } else if s.contains("E170001")
        || s.contains("E175013")
        || s.contains("E165001")
        || s.contains("E000013")
        || s.contains("Permission denied")
        || s.contains("403 Forbidden")
    {
        Some("Sem permissão de escrita nesta pasta do repositório.".into())
    } else if s.contains("E155011") || s.contains("E160024") || s.contains("E170004") {
        Some("Cópia desatualizada — receba do servidor (Atualizar) antes de enviar.".into())
    } else if s.contains("E195016") || s.contains("E195023") || s.contains("reintegr") {
        Some("Reintegração: rode antes o sync (trunk → branch) e garanta a WC limpa.".into())
    } else if s.contains("E125001") || s.contains("E020024") {
        Some("Caminho inválido — verifique se o destino existe.".into())
    } else {
        None
    }
}
