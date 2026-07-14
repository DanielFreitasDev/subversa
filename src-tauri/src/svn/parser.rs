//! Parsing das saídas `--xml` do Subversion.
//!
//! Preferimos XML em vez do texto humano porque ele é estável entre versões e
//! independente do idioma (a CLI do usuário fala português). As estruturas
//! `*Xml` abaixo espelham exatamente o schema do `svn`.

use serde::Deserialize;

use super::types::{
    BlameLine, GraphLogEntry, GraphPath, ListEntry, LogEntry, LogPath, MergedRevision, StatusEntry,
    StatusResult,
};

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
    /// Conflito de texto/propriedade: aponta os arquivos sidecar (base/mine/theirs).
    pub conflict: Option<TextConflictXml>,
    /// Conflito de árvore (mover/apagar dos dois lados); só a presença importa aqui.
    #[serde(rename = "tree-conflict")]
    pub tree_conflict: Option<TreeConflictXml>,
}

/// Bloco `<conflict>` do `svn info --xml` (schema oficial `info.rnc`):
/// `prev-base-file` = BASE (ancestral), `prev-wc-file` = MINE (.mine),
/// `cur-base-file` = THEIRS (versão do servidor), `prop-file` = rejeição `.prej`.
/// Caminhos relativos à pasta do arquivo. Tudo opcional por robustez entre versões.
#[derive(Debug, Deserialize)]
pub struct TextConflictXml {
    #[serde(rename = "prev-base-file")]
    pub prev_base_file: Option<String>,
    #[serde(rename = "prev-wc-file")]
    pub prev_wc_file: Option<String>,
    #[serde(rename = "cur-base-file")]
    pub cur_base_file: Option<String>,
    #[serde(rename = "prop-file")]
    pub prop_file: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // atributos espelham o schema; só a presença é usada hoje
pub struct TreeConflictXml {
    #[serde(rename = "@victim")]
    pub victim: Option<String>,
    #[serde(rename = "@operation")]
    pub operation: Option<String>,
    #[serde(rename = "@kind")]
    pub kind: Option<String>,
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
            let remote_modified = repos_item.as_deref().map(|i| i != "none").unwrap_or(false);
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
    /// `true` quando a revisão foi *removida* por um merge reverso (só existe
    /// nas entradas aninhadas do `svn log -g`).
    #[serde(rename = "@reverse-merge")]
    reverse_merge: Option<bool>,
    author: Option<String>,
    date: Option<String>,
    msg: Option<String>,
    paths: Option<LogPathsXml>,
    /// Com `-g`, o svn aninha aqui as revisões absorvidas por este merge.
    #[serde(rename = "logentry", default)]
    children: Vec<LogEntryXml>,
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
// svn log --xml -v -g (gráfico do projeto)
// ---------------------------------------------------------------------------

/// Parse do log verboso com merge-history (`-g`) para o gráfico do projeto.
/// Revisões viram números (a topologia compara/ordena) e as entradas aninhadas
/// pelo `-g` são achatadas em `merged_revisions`.
pub fn parse_graph_log(xml: &str) -> Result<Vec<GraphLogEntry>, String> {
    let parsed: LogXml =
        quick_xml::de::from_str(xml).map_err(|e| format!("falha ao ler log do gráfico: {e}"))?;
    Ok(parsed.entries.into_iter().map(graph_entry).collect())
}

fn graph_entry(e: LogEntryXml) -> GraphLogEntry {
    let mut merged = Vec::new();
    collect_merged(&e.children, &mut merged);
    GraphLogEntry {
        revision: e.revision.parse().unwrap_or(0),
        author: e.author,
        date: e.date,
        message: e.msg.unwrap_or_default(),
        paths: e
            .paths
            .map(|p| {
                p.paths
                    .into_iter()
                    .map(|x| GraphPath {
                        action: x.action,
                        path: x.path.unwrap_or_default(),
                        kind: x.kind,
                        copyfrom_path: x.copyfrom_path,
                        copyfrom_rev: x.copyfrom_rev.and_then(|s| s.parse().ok()),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        merged_revisions: merged,
    }
}

/// Achata recursivamente as revisões aninhadas pelo `-g` (merge de merge
/// incluído), pulando as marcadas como merge reverso (revisões *removidas*).
fn collect_merged(children: &[LogEntryXml], out: &mut Vec<MergedRevision>) {
    for c in children {
        if c.reverse_merge != Some(true) {
            if let Ok(revision) = c.revision.parse() {
                out.push(MergedRevision {
                    revision,
                    path: c
                        .paths
                        .as_ref()
                        .and_then(|p| p.paths.first())
                        .and_then(|x| x.path.clone()),
                });
            }
        }
        collect_merged(&c.children, out);
    }
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
    // Antes das dicas genéricas de conexão: se o túnel falhou citando o sshpass,
    // o problema é o binário ausente — sem esta dica o erro fica críptico
    // (no modo Auto o app cai para ssh puro em silêncio; ver conn.rs).
    if s.contains("sshpass")
        && (s.contains("E170012") || s.contains("E170013") || s.contains("No such file"))
    {
        Some(
            "O sshpass não está instalado — instale-o (ex.: sudo apt install sshpass) \
             ou troque para autenticação por chave SSH em Configurações."
                .into(),
        )
    } else if s.contains("E155004") {
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
    } else if s.contains("E165006") || s.contains("pre-revprop-change") {
        Some("O servidor não permite editar comentários de revisão (falta o hook pre-revprop-change). Fale com o administrador do SVN.".into())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parses_info_xml() {
        let xml = r#"
            <info>
              <entry kind="dir" path="/wc/sna" revision="4821">
                <url>svn+ssh://host/usr/svn/veiculo/trunk/PROJETOS/sna</url>
                <relative-url>^/trunk/PROJETOS/sna</relative-url>
                <repository>
                  <root>svn+ssh://host/usr/svn/veiculo</root>
                  <uuid>uuid-1</uuid>
                </repository>
                <commit revision="4820">
                  <author>daniel</author>
                  <date>2026-06-22T18:30:00.000Z</date>
                </commit>
              </entry>
            </info>
        "#;

        let parsed = parse_info(xml).unwrap();
        let entry = &parsed.entries[0];
        assert_eq!(entry.kind, "dir");
        assert_eq!(entry.revision, "4821");
        assert_eq!(
            entry.repository.as_ref().unwrap().uuid.as_deref(),
            Some("uuid-1")
        );
        assert_eq!(
            entry.commit.as_ref().unwrap().author.as_deref(),
            Some("daniel")
        );
    }

    // XML real do `svn info --xml` num arquivo em conflito de texto (svn 1.14):
    // o bloco <conflict> traz atributos e filhos <version> que devem ser ignorados,
    // restando os três sidecars (base/mine/theirs).
    #[test]
    fn parses_text_conflict_info_xml() {
        let xml = r#"
            <info>
              <entry path="wc2/A.java" revision="2" kind="file">
                <url>file:///repo/A.java</url>
                <conflict operation="update" type="text">
                  <version revision="1" side="source-left" kind="file" path-in-repos="A.java" repos-url="file:///repo"/>
                  <version side="source-right" kind="file" path-in-repos="A.java" repos-url="file:///repo" revision="2"/>
                  <prev-base-file>/wc2/A.java.r1</prev-base-file>
                  <prev-wc-file>/wc2/A.java.mine</prev-wc-file>
                  <cur-base-file>/wc2/A.java.r2</cur-base-file>
                </conflict>
              </entry>
            </info>
        "#;

        let parsed = parse_info(xml).unwrap();
        let conflict = parsed.entries[0].conflict.as_ref().unwrap();
        assert_eq!(conflict.prev_base_file.as_deref(), Some("/wc2/A.java.r1"));
        assert_eq!(conflict.prev_wc_file.as_deref(), Some("/wc2/A.java.mine"));
        assert_eq!(conflict.cur_base_file.as_deref(), Some("/wc2/A.java.r2"));
        assert!(conflict.prop_file.is_none());
        assert!(parsed.entries[0].tree_conflict.is_none());
    }

    #[test]
    fn parses_status_xml() {
        let xml = r#"
            <status>
              <target path="/wc">
                <entry path="/wc/src/main.rs">
                  <wc-status item="modified" props="none" revision="7" copied="false" wc-locked="false" tree-conflicted="false" />
                  <repos-status item="modified" />
                </entry>
                <against revision="9" />
              </target>
            </status>
        "#;

        let parsed = parse_status(xml, Path::new("/wc"), |_| false).unwrap();
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].rel_path, "src/main.rs");
        assert_eq!(parsed.entries[0].item, "modified");
        assert!(parsed.entries[0].remote_modified);
        assert_eq!(parsed.incoming_count, 1);
        assert_eq!(parsed.against_revision.as_deref(), Some("9"));
    }

    #[test]
    fn parses_log_xml() {
        let xml = r#"
            <log>
              <logentry revision="42">
                <author>maria</author>
                <date>2026-06-23T09:15:00.000Z</date>
                <msg>Corrige fluxo</msg>
                <paths>
                  <path action="M" kind="file" copyfrom-path="/old" copyfrom-rev="41">/trunk/file.rs</path>
                </paths>
              </logentry>
            </log>
        "#;

        let parsed = parse_log(xml).unwrap();
        assert_eq!(parsed[0].revision, "42");
        assert_eq!(parsed[0].message, "Corrige fluxo");
        assert_eq!(parsed[0].paths[0].path, "/trunk/file.rs");
        assert_eq!(parsed[0].paths[0].copyfrom_rev.as_deref(), Some("41"));
    }

    #[test]
    fn parses_list_xml_and_sorts_dirs_first() {
        let xml = r#"
            <lists>
              <list path="svn+ssh://host/repo">
                <entry kind="file">
                  <name>README.md</name>
                  <size>12</size>
                  <commit revision="7"><author>ana</author><date>2026-06-20T14:00:00.000Z</date></commit>
                </entry>
                <entry kind="dir">
                  <name>src</name>
                  <commit revision="8"><author>joao</author><date>2026-06-21T14:00:00.000Z</date></commit>
                </entry>
              </list>
            </lists>
        "#;

        let parsed = parse_list(xml).unwrap();
        assert_eq!(parsed[0].name, "src");
        assert_eq!(parsed[0].kind, "dir");
        assert_eq!(parsed[1].name, "README.md");
        assert_eq!(parsed[1].size, Some(12));
    }

    #[test]
    fn parses_blame_xml_with_content() {
        let xml = r#"
            <blame>
              <target path="file.rs">
                <entry line-number="1">
                  <commit revision="5"><author>ana</author><date>2026-06-20T14:00:00.000Z</date></commit>
                </entry>
                <entry line-number="2" />
              </target>
            </blame>
        "#;

        let parsed = parse_blame(xml, "primeira\nsegunda\n").unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].line_number, 1);
        assert_eq!(parsed[0].revision.as_deref(), Some("5"));
        assert_eq!(parsed[0].content, "primeira");
        assert_eq!(parsed[1].content, "segunda");
    }

    #[test]
    fn parses_graph_log_xml_with_nested_merges() {
        // `svn log -v -g`: o commit 120 é uma reintegração que absorveu a 118
        // (que por sua vez tinha absorvido a 115 num sync) e teve a 110
        // removida por merge reverso — esta última não deve aparecer.
        let xml = r#"
            <log>
              <logentry revision="120">
                <author>daniel</author>
                <date>2026-06-22T10:00:00.000Z</date>
                <msg>Reintegra issue_1234</msg>
                <paths>
                  <path action="M" kind="dir">/trunk/PROJETOS/sna</path>
                </paths>
                <logentry reverse-merge="false" revision="118">
                  <author>maria</author>
                  <date>2026-06-21T10:00:00.000Z</date>
                  <msg>Ajuste no branch</msg>
                  <paths>
                    <path action="M" kind="file">/branches/ISSUES 2026/06 - JUNHO/issue_1234/src/App.java</path>
                  </paths>
                  <logentry reverse-merge="false" revision="115">
                    <msg>Sync do trunk</msg>
                    <paths>
                      <path action="M" kind="file">/trunk/PROJETOS/sna/src/App.java</path>
                    </paths>
                  </logentry>
                </logentry>
                <logentry reverse-merge="true" revision="110">
                  <msg>Removida</msg>
                </logentry>
              </logentry>
              <logentry revision="101">
                <author>maria</author>
                <date>2026-06-18T09:00:00.000Z</date>
                <msg>Branch para issue_1234</msg>
                <paths>
                  <path action="A" kind="dir" copyfrom-path="/trunk/PROJETOS/sna" copyfrom-rev="100">/branches/ISSUES 2026/06 - JUNHO/issue_1234</path>
                </paths>
              </logentry>
            </log>
        "#;

        let parsed = parse_graph_log(xml).unwrap();
        assert_eq!(parsed.len(), 2);

        let merge = &parsed[0];
        assert_eq!(merge.revision, 120);
        assert_eq!(merge.message, "Reintegra issue_1234");
        let merged: Vec<u64> = merge.merged_revisions.iter().map(|m| m.revision).collect();
        assert_eq!(merged, vec![118, 115]); // 110 é reverse-merge → fora
        assert_eq!(
            merge.merged_revisions[0].path.as_deref(),
            Some("/branches/ISSUES 2026/06 - JUNHO/issue_1234/src/App.java")
        );

        let fork = &parsed[1];
        assert_eq!(fork.revision, 101);
        assert_eq!(fork.paths[0].copyfrom_rev, Some(100));
        assert_eq!(
            fork.paths[0].copyfrom_path.as_deref(),
            Some("/trunk/PROJETOS/sna")
        );
        assert!(fork.merged_revisions.is_empty());
    }
}
