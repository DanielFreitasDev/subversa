//! Comandos Tauri expostos ao frontend.
//!
//! Cada operação do fluxo SVN do usuário tem aqui um comando dedicado. Os que
//! escrevem no servidor devolvem [`CommandOutput`] (sucesso + stdout/stderr +
//! dica), para que a UI possa mostrar o resultado mesmo em caso de erro.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use url::Url;

use super::parser;
use super::runner::{
    run, run_checked, run_checked_limited, run_limited, run_raw_checked_limited,
    run_with_progress, LIMIT_BLAME, LIMIT_CAT_FILE, LIMIT_DEFAULT,
};
use super::types::*;
use crate::config;
use crate::AppState;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/// Lê o modo SSH atual sem segurar o lock durante `await`.
fn mode_of(state: &State<AppState>) -> SshMode {
    state
        .config
        .lock()
        .map(|c| c.ssh_mode)
        .unwrap_or(SshMode::Auto)
}

/// Snapshot de (modo, projetos) sem segurar o lock durante `await`.
fn snapshot(state: &State<AppState>) -> (SshMode, Vec<Project>) {
    match state.config.lock() {
        Ok(c) => (c.ssh_mode, c.projects.clone()),
        Err(_) => (SshMode::Auto, Vec::new()),
    }
}

/// Snapshot completo para validações, sem segurar o lock durante `await`.
pub(crate) fn config_snapshot(state: &State<AppState>) -> (SshMode, AppConfig) {
    match state.config.lock() {
        Ok(c) => (c.ssh_mode, c.clone()),
        Err(_) => (SshMode::Auto, AppConfig::default()),
    }
}

pub(crate) fn is_wc(path: &Path) -> bool {
    path.join(".svn").is_dir()
}

fn dec(s: &str) -> String {
    s.replace("%20", " ")
}

/// Deriva o tipo de linha (trunk/branch/tag) e um rótulo legível.
fn derive_branch(relative_url: &str) -> (BranchKind, String) {
    let raw = relative_url.trim_start_matches("^/");
    let r = dec(raw);
    if r == "trunk" || r.starts_with("trunk/") {
        (BranchKind::Trunk, "trunk".to_string())
    } else if let Some(rest) = r.strip_prefix("branches/") {
        (BranchKind::Branch, rest.to_string())
    } else if let Some(rest) = r.strip_prefix("tags/") {
        (BranchKind::Tag, rest.to_string())
    } else {
        (BranchKind::Other, r)
    }
}

/// Encontra o projeto-preset correspondente (por nome de pasta ou URL exata).
fn match_project(folder: &str, url: &str, projects: &[Project]) -> Option<Project> {
    if let Some(p) = projects.iter().find(|p| p.key == folder) {
        return Some(p.clone());
    }
    let durl = dec(url);
    projects.iter().find(|p| dec(&p.url) == durl).cloned()
}

const ALLOWED_REMOTE_SCHEMES: [&str; 5] = ["svn+ssh", "svn", "http", "https", "file"];

fn parse_svn_url(raw: &str, label: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} não pode ser vazia."));
    }
    let parseable = trimmed.replace(' ', "%20");
    let url = Url::parse(&parseable)
        .map_err(|e| format!("{label} inválida: {e}. Use uma URL SVN completa."))?;
    if !ALLOWED_REMOTE_SCHEMES.contains(&url.scheme()) {
        return Err(
            "esquema de URL SVN inválido. Use svn+ssh://, svn://, http://, https:// ou file://."
                .into(),
        );
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("URL SVN inválida: remova query string ou fragmento.".into());
    }
    Ok(url)
}

fn normalized_remote_url(raw: &str, label: &str) -> Result<String, String> {
    let url = parse_svn_url(raw, label)?;
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn is_under_remote_location(candidate: &str, location: &str) -> bool {
    candidate == location
        || candidate
            .strip_prefix(location)
            .map(|rest| rest.starts_with('/') || rest.starts_with('@'))
            .unwrap_or(false)
}

fn configured_remote_locations(cfg: &AppConfig) -> Vec<&str> {
    cfg.repo_roots
        .iter()
        .map(String::as_str)
        .chain(cfg.projects.iter().map(|p| p.url.as_str()))
        .filter(|s| !s.trim().is_empty())
        .collect()
}

fn validate_remote_url_for_scope(raw: &str, cfg: &AppConfig, action: &str) -> Result<(), String> {
    let candidate = normalized_remote_url(raw, "URL SVN")?;
    let mut saw_valid_location = false;

    for location in configured_remote_locations(cfg) {
        if let Ok(root) = normalized_remote_url(location, "localização configurada") {
            saw_valid_location = true;
            if is_under_remote_location(&candidate, &root) {
                return Ok(());
            }
        }
    }

    if !saw_valid_location {
        return Err(
            "nenhuma localização de repositório válida está configurada. Cadastre repoRoots ou projetos em Configurações."
                .into(),
        );
    }

    Err(format!(
        "{action} bloqueada: URL fora das localizações configuradas. Cadastre a raiz em Configurações antes de usar esta URL."
    ))
}

fn validate_remote_url_for_read(raw: &str, cfg: &AppConfig) -> Result<(), String> {
    validate_remote_url_for_scope(raw, cfg, "leitura remota")
}

fn validate_remote_url_for_write(raw: &str, cfg: &AppConfig) -> Result<(), String> {
    validate_remote_url_for_scope(raw, cfg, "operação remota")
}

fn looks_like_remote_url(value: &str) -> bool {
    value.contains("://")
}

fn normalize_local_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn comparable_local_path(path: &Path) -> PathBuf {
    if let Ok(canon) = path.canonicalize() {
        return canon;
    }
    for ancestor in path.ancestors().skip(1) {
        if let Ok(canon) = ancestor.canonicalize() {
            if let Ok(rest) = path.strip_prefix(ancestor) {
                return normalize_local_path(&canon.join(rest));
            }
        }
    }
    normalize_local_path(path)
}

pub(crate) fn validate_local_path(
    raw: &str,
    cfg: &AppConfig,
    label: &str,
    must_stay_in_base_dir: bool,
    must_be_existing_dir: bool,
) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} não pode ser vazio."));
    }
    if trimmed.contains('\0') {
        return Err(format!("{label} contém caractere inválido."));
    }
    let path = normalize_local_path(Path::new(trimmed));
    if !path.is_absolute() {
        return Err(format!("{label} precisa ser um caminho absoluto."));
    }

    if must_be_existing_dir {
        let meta = std::fs::metadata(&path)
            .map_err(|e| format!("{label} não existe ou não está acessível: {e}"))?;
        if !meta.is_dir() {
            return Err(format!("{label} precisa ser uma pasta."));
        }
    }

    if must_stay_in_base_dir {
        let base = validate_local_path(
            &cfg.base_dir,
            cfg,
            "pasta de trabalho configurada",
            false,
            false,
        )?;
        let target_cmp = comparable_local_path(&path);
        let base_cmp = comparable_local_path(&base);
        if !target_cmp.starts_with(&base_cmp) {
            return Err(format!(
                "destino fora da pasta de trabalho configurada. Escolha um caminho dentro de {}.",
                base.display()
            ));
        }
    }

    Ok(path)
}

fn validate_non_empty_message(message: &str) -> Result<(), String> {
    if message.trim().is_empty() {
        Err("a mensagem do commit não pode ser vazia".into())
    } else {
        Ok(())
    }
}

fn validate_resolve_accept(accept: &str) -> Result<(), String> {
    match accept {
        "working" | "mine-full" | "theirs-full" | "base" | "mine-conflict" | "theirs-conflict" => {
            Ok(())
        }
        _ => Err("opção de resolução inválida.".into()),
    }
}

/// Constrói uma [`WorkingCopy`] a partir de `svn info` + `svn status` (locais).
async fn build_working_copy(
    path: &Path,
    projects: &[Project],
    mode: SshMode,
) -> Result<WorkingCopy, String> {
    let path_str = path.to_string_lossy().to_string();

    let info_xml = run_checked(&["info", "--xml", "--", &path_str], None, mode).await?;
    let info = parser::parse_info(&info_xml)?;
    let entry = info
        .entries
        .into_iter()
        .next()
        .ok_or_else(|| "svn info não retornou dados".to_string())?;

    let url = entry.url.unwrap_or_default();
    let relative_url = entry.relative_url.unwrap_or_default();
    let repo_root = entry
        .repository
        .as_ref()
        .and_then(|r| r.root.clone())
        .unwrap_or_default();
    let uuid = entry.repository.and_then(|r| r.uuid);

    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    let (kind, branch_label) = derive_branch(&relative_url);
    let project = match_project(&name, &url, projects);
    let project_key = project.as_ref().map(|p| p.key.clone());
    let is_mainline = match &project {
        Some(p) => dec(&url) == dec(&p.url),
        None => relative_url.starts_with("^/trunk"),
    };

    // status local para contar modificações e detectar conflitos
    let status_xml = run(&["status", "--xml", "--", &path_str], None, mode)
        .await
        .map(|o| o.stdout)
        .unwrap_or_default();
    let (mut modified_count, mut has_conflicts) = (0u32, false);
    if let Ok(st) = parser::parse_status(&status_xml, path, |p| p.is_dir()) {
        for e in &st.entries {
            let actionable = matches!(
                e.item.as_str(),
                "modified"
                    | "added"
                    | "deleted"
                    | "replaced"
                    | "missing"
                    | "obstructed"
                    | "conflicted"
            ) || e.props == "modified"
                || e.props == "conflicted";
            if actionable {
                modified_count += 1;
            }
            if e.item == "conflicted" || e.tree_conflicted || e.props == "conflicted" {
                has_conflicts = true;
            }
        }
    }

    Ok(WorkingCopy {
        path: path_str,
        name,
        url,
        relative_url,
        repo_root,
        revision: entry.revision,
        last_changed_rev: entry.commit.as_ref().map(|c| c.revision.clone()),
        last_changed_author: entry.commit.as_ref().and_then(|c| c.author.clone()),
        last_changed_date: entry.commit.and_then(|c| c.date),
        kind,
        branch_label,
        is_mainline,
        modified_count,
        has_conflicts,
        project_key,
        uuid,
    })
}

// ---------------------------------------------------------------------------
// Detecção / leitura (offline e online)
// ---------------------------------------------------------------------------

/// Detecta working copies em `base` (a própria pasta, se for uma WC; senão,
/// as subpastas imediatas que forem WCs).
#[tauri::command]
pub async fn detect_working_copies(
    base: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkingCopy>, String> {
    let (mode, projects) = snapshot(&state);
    let base = PathBuf::from(&base);

    let mut candidates: Vec<PathBuf> = Vec::new();
    if is_wc(&base) {
        candidates.push(base.clone());
    } else if let Ok(rd) = std::fs::read_dir(&base) {
        let mut dirs: Vec<PathBuf> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_dir() && is_wc(p))
            .collect();
        dirs.sort();
        candidates.extend(dirs);
    }

    let mut out = Vec::new();
    for c in candidates {
        match build_working_copy(&c, &projects, mode).await {
            Ok(wc) => out.push(wc),
            Err(_) => { /* ignora pastas problemáticas em vez de derrubar tudo */ }
        }
    }
    Ok(out)
}

/// Info detalhada de uma working copy.
#[tauri::command]
pub async fn get_info(path: String, state: State<'_, AppState>) -> Result<WorkingCopy, String> {
    let (mode, projects) = snapshot(&state);
    build_working_copy(Path::new(&path), &projects, mode).await
}

/// `svn status` (local) ou `svn status -u` (consulta o servidor).
#[tauri::command]
pub async fn get_status(
    path: String,
    remote: bool,
    state: State<'_, AppState>,
) -> Result<StatusResult, String> {
    let mode = mode_of(&state);
    let mut args = vec!["status", "--xml", "--non-interactive"];
    if remote {
        args.push("-u");
    }
    args.push("--");
    args.push(&path);
    let out = run(&args, None, mode).await?;
    if !out.success {
        let mut msg = out.stderr.trim().to_string();
        if let Some(h) = out.hint {
            msg.push_str("\n\n");
            msg.push_str(&h);
        }
        return Err(msg);
    }
    parser::parse_status(&out.stdout, Path::new(&path), |p| p.is_dir())
}

/// `svn diff` (contra a BASE local) de toda a WC ou de arquivos específicos.
/// O tratamento de espaços em branco e o realce são aplicados no frontend
/// (estilo IntelliJ), sobre o diff completo.
#[tauri::command]
pub async fn get_diff(
    path: String,
    files: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["diff".into(), "--internal-diff".into(), "--".into()];
    match files {
        Some(fs) if !fs.is_empty() => args.extend(fs),
        _ => args.push(path),
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_checked(&refs, None, mode).await
}

/// Diff de uma revisão inteira (`target` = caminho da WC ou URL) ou de um único
/// caminho (`target` = URL completa do arquivo no repositório).
///
/// Usa `-c REV` (equivale a `-r REV-1:REV`), que cobre o caso de borda da r1
/// sozinho. Se a revisão não tocar o `target`, o SVN retorna vazio e a UI mostra
/// "Sem diferenças.". Espaços/realce são tratados no frontend.
#[tauri::command]
pub async fn diff_revision(
    target: String,
    revision: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if revision.trim().is_empty() {
        return Err("Revisão inválida.".into());
    }
    let (mode, cfg) = config_snapshot(&state);
    if looks_like_remote_url(&target) {
        validate_remote_url_for_read(&target, &cfg)?;
    }
    let change = format!("-c{}", revision.trim());
    let args: Vec<&str> = vec![
        "diff",
        "--internal-diff",
        "--non-interactive",
        change.as_str(),
        "--",
        target.as_str(),
    ];
    run_checked_limited(&args, None, mode, LIMIT_DEFAULT).await
}

/// Histórico (`svn log -v`). `target` pode ser um caminho de WC ou uma URL.
///
/// `rev_range` (ex.: `{2026-01-01}:{2026-06-01}` ou `1000:2000`) filtra por
/// intervalo de revisão/data; `search` casa autor+mensagem (`--search`).
#[tauri::command]
pub async fn get_log(
    target: String,
    limit: u32,
    search: Option<String>,
    rev_range: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<LogEntry>, String> {
    let (mode, cfg) = config_snapshot(&state);
    if looks_like_remote_url(&target) {
        validate_remote_url_for_read(&target, &cfg)?;
    }
    let limit_s = limit.to_string();
    let mut args: Vec<String> = vec![
        "log".into(),
        "--xml".into(),
        "-v".into(),
        "-l".into(),
        limit_s,
        "--non-interactive".into(),
    ];
    if let Some(range) = rev_range.filter(|s| !s.trim().is_empty()) {
        args.push("-r".into());
        args.push(range);
    }
    if let Some(term) = search.filter(|s| !s.trim().is_empty()) {
        args.push("--search".into());
        args.push(term);
    }
    args.push("--".into());
    args.push(target);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let xml = run_checked_limited(&refs, None, mode, LIMIT_DEFAULT).await?;
    parser::parse_log(&xml)
}

/// Lê a revisão de `svn info` (BASE por padrão, ou na revisão `rev`).
async fn info_revision(path: &str, rev: Option<&str>, mode: SshMode) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["info", "--xml", "--non-interactive"];
    if let Some(r) = rev {
        args.push("-r");
        args.push(r);
    }
    args.push("--");
    args.push(path);
    let xml = run_checked(&args, None, mode).await?;
    parser::parse_info(&xml)?
        .entries
        .into_iter()
        .next()
        .map(|e| e.revision)
        .ok_or_else(|| "svn info não retornou dados".to_string())
}

/// Lê a URL atual de uma working copy (`svn info`).
async fn info_url(path: &str, mode: SshMode) -> Result<String, String> {
    let xml = run_checked(
        &["info", "--xml", "--non-interactive", "--", path],
        None,
        mode,
    )
    .await?;
    parser::parse_info(&xml)?
        .entries
        .into_iter()
        .next()
        .and_then(|e| e.url)
        .ok_or_else(|| "não consegui obter a URL da working copy.".to_string())
}

/// "Entrada": o que chega do servidor ao atualizar a WC — as revisões entre a
/// BASE e o HEAD que afetam este caminho (autor, mensagem e arquivos), na mesma
/// forma do histórico para que a UI as detalhe e diferencie igual ao Histórico.
#[tauri::command]
pub async fn incoming(
    path: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<IncomingResult, String> {
    let mode = mode_of(&state);
    let base = info_revision(&path, None, mode).await?;
    // HEAD do servidor (melhor esforço: o nó pode ter sido removido no HEAD).
    let head = info_revision(&path, Some("HEAD"), mode).await.ok();

    let limit_s = limit.unwrap_or(200).to_string();
    let range = format!("HEAD:{base}");
    let xml = run_checked_limited(
        &[
            "log",
            "--xml",
            "-v",
            "-l",
            &limit_s,
            "-r",
            &range,
            "--non-interactive",
            "--",
            &path,
        ],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    let mut entries = parser::parse_log(&xml)?;
    // A BASE já está na WC — só interessa o que vem depois dela.
    entries.retain(|e| e.revision != base);

    Ok(IncomingResult {
        base_revision: base,
        head_revision: head,
        entries,
    })
}

/// Lista o conteúdo de uma URL no repositório (navegador de branches).
#[tauri::command]
pub async fn list_dir(url: String, state: State<'_, AppState>) -> Result<Vec<ListEntry>, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    let xml = run_checked_limited(
        &["list", "--xml", "--non-interactive", "--", &url],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    parser::parse_list(&xml)
}

/// Listagem RECURSIVA de uma URL (`svn list -R`): toda a subárvore numa única
/// ida ao servidor. Sob `-R`, o `<name>` de cada entrada vem como caminho
/// relativo à URL (`pasta/sub/arq.txt`) e cada pasta também é listada — o
/// frontend reconstrói os filhos por pasta a partir disso. Usado por "Expandir
/// tudo" e pela busca por nome.
#[tauri::command]
pub async fn list_tree(url: String, state: State<'_, AppState>) -> Result<Vec<ListEntry>, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    let xml = run_checked_limited(
        &["list", "-R", "--xml", "--non-interactive", "--", &url],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    let entries = parser::parse_list(&xml)?;
    // Descarta entradas sem nome (defensivo: a entrada-raiz pode vir vazia).
    Ok(entries.into_iter().filter(|e| !e.name.is_empty()).collect())
}

// Tetos da busca por conteúdo: cada arquivo é baixado por `svn cat` via SSH e
// isso custa caro. Os limites mantêm a varredura rápida e o payload são para a UI.
const SEARCH_MAX_FILE_BYTES: u64 = 1024 * 1024; // 1 MiB: ignora arquivos grandes/não-fonte
const SEARCH_MAX_FILES_SCANNED: u64 = 1000; // teto de arquivos baixados
const SEARCH_MAX_MATCHES_PER_FILE: usize = 50;
const SEARCH_MAX_TOTAL_MATCHES: usize = 1000;
const SEARCH_SNIPPET_MAX_CHARS: usize = 240;

/// Extensões tratadas como binárias — puladas sem baixar (buscar texto não faz sentido).
const SEARCH_BINARY_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "ico", "webp", "svg", "pdf", "zip", "jar", "war", "ear",
    "class", "so", "dll", "exe", "bin", "o", "a", "tar", "gz", "tgz", "bz2", "7z", "rar", "mp3",
    "mp4", "mov", "avi", "mkv", "wav", "ogg", "woff", "woff2", "ttf", "otf", "eot",
];

/// `true` se o nome (possivelmente percent-encodado) tem extensão na denylist binária.
fn has_binary_ext(name: &str) -> bool {
    match name.rsplit('.').next() {
        Some(ext) if ext.len() < name.len() => {
            SEARCH_BINARY_EXTS.contains(&ext.to_ascii_lowercase().as_str())
        }
        _ => false,
    }
}

/// `true` se o conteúdo parece binário (NUL nos primeiros 8 KB) — mesma heurística
/// do editor de conflitos.
fn looks_binary(s: &str) -> bool {
    s.as_bytes().iter().take(8192).any(|&b| b == 0)
}

/// Busca por CONTEÚDO sob uma URL-base: enumera os arquivos (`svn list -R`) e baixa
/// cada um (`svn cat`) procurando o termo, linha a linha (case-insensitive). Pula
/// binários (extensão + NUL) e arquivos grandes, com tetos de arquivos e de
/// ocorrências. Emite progresso pelo canal `op-progress` (op `"search"`) para a
/// barra de busca mostrar "Verificando… N arquivos".
#[tauri::command]
pub async fn search_content(
    base_url: String,
    query: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ContentSearchResult, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&base_url, &cfg)?;
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 2 {
        return Err("digite ao menos 2 caracteres para buscar por conteúdo.".into());
    }

    // Enumera a subárvore uma vez (mesmo `svn list -R` da expansão).
    let xml = run_checked_limited(
        &["list", "-R", "--xml", "--non-interactive", "--", &base_url],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    let entries = parser::parse_list(&xml)?;

    let id = next_op_id();
    emit_op_progress(&app, id, "search", 0, "", false);

    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut files_scanned: u64 = 0;
    let mut files_matched: u64 = 0;
    let mut truncated = false;
    let mut last_emit = Instant::now();

    for e in entries {
        if e.kind != "file" || e.name.is_empty() || has_binary_ext(&e.name) {
            continue;
        }
        if e.size.map(|s| s > SEARCH_MAX_FILE_BYTES).unwrap_or(false) {
            continue;
        }
        if files_scanned >= SEARCH_MAX_FILES_SCANNED || matches.len() >= SEARCH_MAX_TOTAL_MATCHES {
            truncated = true;
            break;
        }

        let file_url = format!("{base_url}/{}", e.name);
        let text = match run_checked_limited(
            &["cat", "--non-interactive", "--", &file_url],
            None,
            mode,
            LIMIT_CAT_FILE,
        )
        .await
        {
            Ok(t) => t,
            Err(_) => continue, // arquivo ilegível/removido: pula, não aborta a busca
        };
        files_scanned += 1;

        if !looks_binary(&text) {
            let mut file_hits = 0usize;
            for (i, raw) in text.lines().enumerate() {
                if !raw.to_lowercase().contains(&needle) {
                    continue;
                }
                let trimmed = raw.trim();
                let snippet = if trimmed.chars().count() > SEARCH_SNIPPET_MAX_CHARS {
                    let clipped: String = trimmed.chars().take(SEARCH_SNIPPET_MAX_CHARS).collect();
                    format!("{clipped}…")
                } else {
                    trimmed.to_string()
                };
                matches.push(SearchMatch {
                    path: e.name.clone(),
                    line: (i as u64) + 1,
                    snippet,
                });
                file_hits += 1;
                if file_hits >= SEARCH_MAX_MATCHES_PER_FILE
                    || matches.len() >= SEARCH_MAX_TOTAL_MATCHES
                {
                    truncated = true;
                    break;
                }
            }
            if file_hits > 0 {
                files_matched += 1;
            }
        }

        let now = Instant::now();
        if now.duration_since(last_emit) >= PROGRESS_INTERVAL {
            last_emit = now;
            emit_op_progress(&app, id, "search", files_scanned, &e.name, false);
        }
    }

    emit_op_progress(&app, id, "search", files_scanned, "", true);
    Ok(ContentSearchResult {
        matches,
        files_scanned,
        files_matched,
        truncated,
    })
}

/// Conteúdo de um arquivo do servidor/revisão (`svn cat`).
#[tauri::command]
pub async fn cat_file(
    target: String,
    revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&target, &cfg)?;
    let mut args: Vec<String> = vec!["cat".into(), "--non-interactive".into()];
    if let Some(r) = revision {
        args.push("-r".into());
        args.push(r);
    }
    args.push("--".into());
    args.push(target);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_checked_limited(&refs, None, mode, LIMIT_CAT_FILE).await
}

/// Autoria por linha (`svn blame`) combinada com o conteúdo (`svn cat`).
#[tauri::command]
pub async fn blame(target: String, state: State<'_, AppState>) -> Result<Vec<BlameLine>, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&target, &cfg)?;
    let xml = run_checked_limited(
        &["blame", "--xml", "--non-interactive", "--", &target],
        None,
        mode,
        LIMIT_BLAME,
    )
    .await?;
    let content = run_checked_limited(
        &["cat", "--non-interactive", "--", &target],
        None,
        mode,
        LIMIT_BLAME,
    )
    .await
    .unwrap_or_default();
    parser::parse_blame(&xml, &content)
}

/// `svn info` de uma URL remota → [`UrlInfo`] (revisão no breadcrumb/painel e
/// validação de localização no navegador de repositórios).
#[tauri::command]
pub async fn get_url_info(url: String, state: State<'_, AppState>) -> Result<UrlInfo, String> {
    let mode = mode_of(&state);
    parse_svn_url(&url, "URL SVN")?;
    let xml = run_checked_limited(
        &["info", "--xml", "--non-interactive", "--", &url],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    let info = parser::parse_info(&xml)?;
    let entry = info
        .entries
        .into_iter()
        .next()
        .ok_or_else(|| "svn info não retornou dados".to_string())?;
    Ok(UrlInfo {
        url: entry.url.clone().unwrap_or(url),
        repo_root: entry
            .repository
            .as_ref()
            .and_then(|r| r.root.clone())
            .unwrap_or_default(),
        relative_url: entry.relative_url.unwrap_or_default(),
        revision: entry.revision,
        kind: entry.kind,
        last_changed_rev: entry.commit.as_ref().map(|c| c.revision.clone()),
        last_changed_author: entry.commit.as_ref().and_then(|c| c.author.clone()),
        last_changed_date: entry.commit.and_then(|c| c.date),
    })
}

/// Diff entre duas URLs (Comparar com…). Usa `--old/--new` (forma canônica);
/// cada uma aceita `URL@REV`. Não usa `--` porque as flags consomem o próximo
/// argumento. Espaços/realce são tratados no frontend.
#[tauri::command]
pub async fn diff_urls(
    old_url: String,
    new_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&old_url, &cfg)?;
    validate_remote_url_for_read(&new_url, &cfg)?;
    let args: Vec<&str> = vec![
        "diff",
        "--internal-diff",
        "--non-interactive",
        "--old",
        old_url.as_str(),
        "--new",
        new_url.as_str(),
    ];
    run_checked_limited(&args, None, mode, LIMIT_DEFAULT).await
}

// ---------------------------------------------------------------------------
// Operações que escrevem (servidor ou WC)
// ---------------------------------------------------------------------------

/// Nome do evento de progresso emitido durante operações de transferência.
const OP_PROGRESS_EVENT: &str = "op-progress";

/// Intervalo mínimo entre eventos de progresso: uma operação grande imprime
/// milhares de linhas em rajada — sem isso, inundaríamos o IPC com a UI.
pub(crate) const PROGRESS_INTERVAL: Duration = Duration::from_millis(60);

/// Contador monotônico de execuções, para dar um `id` único a cada operação
/// (a UI distingue cartões de operações simultâneas por ele).
static OP_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn next_op_id() -> u64 {
    OP_SEQ.fetch_add(1, Ordering::Relaxed)
}

/// Emite um evento `op-progress` para a UI (painel de atividade). Compartilhado
/// pelas operações `svn` em streaming e pelos backups/restaurações.
pub(crate) fn emit_op_progress(
    app: &AppHandle,
    id: u64,
    op: &str,
    count: u64,
    path: &str,
    done: bool,
) {
    let _ = app.emit(
        OP_PROGRESS_EVENT,
        OpProgress {
            id,
            op: op.to_string(),
            count,
            path: path.to_string(),
            done,
        },
    );
}

/// Extrai o caminho de uma linha de progresso do `svn` (`"A    caminho"`): o
/// primeiro caractere é um código de ação e o segundo é espaço. Vale para
/// checkout/update/switch/merge/export, que usam esse formato de coluna
/// independente de idioma. Distingue de linhas como "Checked out revision N."/
/// "Obtida a revisão N." (segundo caractere é letra), que não contam como
/// arquivo. (Commit/import usam verbos traduzidos e ficam de fora de propósito.)
fn progress_path(line: &str) -> Option<&str> {
    let mut chars = line.chars();
    let code = chars.next()?;
    if !matches!(code, 'A' | 'D' | 'U' | 'C' | 'G' | 'E' | 'R') || chars.next()? != ' ' {
        return None;
    }
    let path = line[1..].trim();
    (!path.is_empty()).then_some(path)
}

/// Roda um comando `svn` transmitindo o progresso por arquivo via `op-progress`.
/// Emite um evento inicial (a UI aparece já), eventos intermediários com
/// throttle, e um evento final `done` (mesmo em erro, para a UI fechar o
/// cartão). O `CommandOutput` completo é devolvido normalmente.
async fn run_streaming_op(
    app: &AppHandle,
    op: &str,
    args: &[&str],
    cwd: Option<&Path>,
    mode: SshMode,
) -> Result<CommandOutput, String> {
    let id = next_op_id();
    // Evento inicial: a UI mostra "<operação>…" antes mesmo do primeiro arquivo.
    emit_op_progress(app, id, op, 0, "", false);

    let emitter = app.clone();
    let op_label = op.to_string();
    let mut count: u64 = 0;
    let mut last_emit = Instant::now();
    let on_line = |line: &str| {
        let Some(path) = progress_path(line) else {
            return;
        };
        count += 1;
        let now = Instant::now();
        if now.duration_since(last_emit) >= PROGRESS_INTERVAL {
            last_emit = now;
            emit_op_progress(&emitter, id, &op_label, count, path, false);
        }
    };

    let out = run_with_progress(args, cwd, mode, LIMIT_DEFAULT, on_line).await;

    // Evento final com o total exato (o throttle pode ter omitido a última
    // rajada). Emitido também em erro, para a UI remover o cartão.
    emit_op_progress(app, id, op, count, "", true);
    out
}

#[tauri::command]
pub async fn checkout(
    url: String,
    dest: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    let dest = validate_local_path(&dest, &cfg, "destino do checkout", true, false)?;
    let dest = dest.to_string_lossy().to_string();
    run_streaming_op(
        &app,
        "checkout",
        &["checkout", "--non-interactive", "--", &url, &dest],
        None,
        mode,
    )
    .await
}

#[tauri::command]
pub async fn update(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run_streaming_op(
        &app,
        "update",
        &[
            "update",
            "--non-interactive",
            "--accept",
            "postpone",
            "--",
            &path,
        ],
        None,
        mode,
    )
    .await
}

#[tauri::command]
pub async fn commit(
    paths: Vec<String>,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo selecionado para commit".into());
    }
    validate_non_empty_message(&message)?;
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec![
        "commit".into(),
        "--non-interactive".into(),
        "-m".into(),
        message,
    ];
    args.push("--".into());
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run(&refs, None, mode).await
}

#[tauri::command]
pub async fn svn_add(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo para adicionar".into());
    }
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["add".into(), "--parents".into()];
    args.push("--".into());
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run(&refs, None, mode).await
}

#[tauri::command]
pub async fn revert(
    paths: Vec<String>,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo para reverter".into());
    }
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["revert".into()];
    if recursive {
        args.push("-R".into());
    }
    args.push("--".into());
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run(&refs, None, mode).await
}

/// Referência a um trecho do diff exibido, montada no frontend. O backend
/// reconstrói o patch a partir do `svn diff` **bruto** (não do texto exibido) e
/// usa a assinatura para confirmar que ainda é o mesmo trecho.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkRef {
    /// Índice do trecho na ordem de documento (hunks → blocos) do arquivo.
    pub block_index: u32,
    /// Quantos trechos o frontend via no arquivo (detecta diff defasado).
    pub total_blocks: u32,
    /// 1ª linha do trecho na base (0 se adição pura).
    pub first_old: u32,
    /// 1ª linha do trecho no trabalho (0 se remoção pura).
    pub first_new: u32,
    pub add_count: u32,
    pub del_count: u32,
}

/// Falha "o trecho não casou": o arquivo mudou desde que o diff foi exibido.
fn hunk_stale_output() -> CommandOutput {
    CommandOutput {
        success: false,
        code: None,
        stdout: String::new(),
        stderr: String::new(),
        hint: Some(
            "O trecho não casou com o arquivo atual — ele pode ter mudado desde que o diff foi gerado. Atualize as alterações e tente de novo."
                .into(),
        ),
        command: "svn patch --reverse-diff".into(),
    }
}

/// Reverte um único **trecho** (change-block) de um arquivo modificado da working
/// copy, sem tocar nos demais trechos do mesmo arquivo — o equivalente à setinha
/// `>>` do IntelliJ.
///
/// O patch é um diff unificado mínimo (cabeçalho + um hunk) no sentido **direto**
/// (base→trabalho) contendo só aquele trecho. Ele é **remontado aqui no backend**
/// a partir do `svn diff` bruto (bytes) — e não do texto exibido na UI, que é
/// decodificado como UTF-8 *lossy* e corromperia o contexto de arquivos não-UTF-8
/// (ex.: Latin-1), fazendo o `svn patch` rejeitar o trecho. Aplicamos com
/// `svn patch --reverse-diff`, que o desfaz: evita inverter `+`/`-` à mão e
/// preserva o tratamento de EOL/quebra-final do próprio Subversion.
///
/// Cuidado importante: o `svn patch` retorna **0 mesmo quando o trecho não casa**
/// (o arquivo mudou desde que o diff foi gerado). Nesse caso ele imprime a letra
/// de status `C`, escreve `<arquivo>.svnpatch.rej` ao lado do alvo e segue. Aqui
/// detectamos a rejeição, removemos o `.rej` (senão ele apareceria como arquivo
/// novo na lista de alterações) e devolvemos falha com uma dica — para a UI não
/// anunciar um sucesso falso.
#[tauri::command]
pub async fn revert_hunk(
    wc_path: String,
    target: String,
    hunk: HunkRef,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    let wc = validate_local_path(&wc_path, &cfg, "working copy", true, false)?;
    let tgt = validate_local_path(&target, &cfg, "arquivo", true, false)?;
    let tgt_s = tgt.to_string_lossy().to_string();

    // Diff bruto do arquivo (bytes): preserva a codificação original, então o
    // corpo do patch tem exatamente os bytes que o `svn patch` vai conferir.
    let diff = run_raw_checked_limited(
        &["diff", "--internal-diff", "--", &tgt_s],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await?;
    let blocks = super::hunk::extract_blocks(&diff, &tgt_s);

    // O arquivo pode ter mudado desde que a UI montou o diff: confere a
    // quantidade de trechos e a assinatura do trecho-alvo antes de aplicar.
    if blocks.len() as u32 != hunk.total_blocks {
        return Ok(hunk_stale_output());
    }
    let block = match blocks.get(hunk.block_index as usize) {
        Some(b) => b,
        None => return Ok(hunk_stale_output()),
    };
    if block.first_old != hunk.first_old
        || block.first_new != hunk.first_new
        || block.add_count != hunk.add_count
        || block.del_count != hunk.del_count
    {
        return Ok(hunk_stale_output());
    }

    let tmp = std::env::temp_dir().join(format!(
        "subversa-hunk-{}-{}.patch",
        std::process::id(),
        next_op_id()
    ));
    std::fs::write(&tmp, &block.patch)
        .map_err(|e| format!("não consegui preparar o trecho: {e}"))?;
    let tmp_s = tmp.to_string_lossy().to_string();
    let wc_s = wc.to_string_lossy().to_string();

    let out = run(
        &["patch", "--reverse-diff", "--", &tmp_s, &wc_s],
        None,
        mode,
    )
    .await;
    let _ = std::fs::remove_file(&tmp);

    let mut out = out?;
    // `C` é letra de status do `svn patch` (independente de idioma); "rejected
    // hunk" reforça a detecção. Em ambos os casos houve rejeição.
    let rejected = out.stdout.lines().any(|l| {
        let t = l.trim_start();
        t.starts_with("C ") || t.starts_with("C\t") || t.contains("rejected hunk")
    });
    if rejected {
        let rej = PathBuf::from(format!("{}.svnpatch.rej", tgt.to_string_lossy()));
        let _ = std::fs::remove_file(&rej);
        out.success = false;
        if out.hint.is_none() {
            out.hint = Some(
                "O trecho não casou com o arquivo atual — ele pode ter mudado desde que o diff foi gerado. Atualize as alterações e tente de novo."
                    .into(),
            );
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn remove(
    paths: Vec<String>,
    keep_local: bool,
    force: bool,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    if paths.is_empty() {
        return Err("nenhum arquivo para remover".into());
    }
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["delete".into()];
    if keep_local {
        args.push("--keep-local".into());
    }
    // `--force` permite apagar um arquivo não versionado (stray) do disco.
    if force {
        args.push("--force".into());
    }
    args.push("--".into());
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run(&refs, None, mode).await
}

#[tauri::command]
pub async fn create_branch(
    source_url: String,
    branch_url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_non_empty_message(&message)?;
    validate_remote_url_for_read(&source_url, &cfg)?;
    validate_remote_url_for_write(&branch_url, &cfg)?;
    run_limited(
        &[
            "copy",
            "--parents",
            "--non-interactive",
            "-m",
            &message,
            "--",
            &source_url,
            &branch_url,
        ],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

#[tauri::command]
pub async fn switch_wc(
    path: String,
    url: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    validate_local_path(&path, &cfg, "working copy", true, false)?;
    run_streaming_op(
        &app,
        "switch",
        &[
            "switch",
            "--non-interactive",
            "--accept",
            "postpone",
            "--",
            &url,
            &path,
        ],
        None,
        mode,
    )
    .await
}

#[tauri::command]
pub async fn merge(
    path: String,
    source_url: String,
    dry_run: bool,
    record_only: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&source_url, &cfg)?;
    validate_local_path(&path, &cfg, "working copy", true, false)?;
    let mut args: Vec<String> = vec![
        "merge".into(),
        "--non-interactive".into(),
        "--accept".into(),
        "postpone".into(),
    ];
    if dry_run {
        args.push("--dry-run".into());
    }
    if record_only {
        args.push("--record-only".into());
    }
    args.push("--".into());
    args.push(source_url);
    args.push(path);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_streaming_op(&app, "merge", &refs, None, mode).await
}

/// Reverte as mudanças de uma revisão na cópia local (merge reverso). Não
/// escreve no servidor: aplica o inverso de `revision` na WC para o usuário
/// revisar e commitar depois (a publicação é o commit, como na Integração).
#[tauri::command]
pub async fn reverse_merge(
    path: String,
    revision: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let n: i64 = revision
        .trim()
        .parse()
        .map_err(|_| "revisão inválida.".to_string())?;
    let (mode, cfg) = config_snapshot(&state);
    validate_local_path(&path, &cfg, "working copy", true, false)?;
    // A fonte do merge reverso é a própria URL da WC (a linha onde a revisão vive).
    let url = info_url(&path, mode).await?;
    validate_remote_url_for_read(&url, &cfg)?;
    // -r N:N-1 desfaz exatamente a revisão N — dois números positivos, sem a
    // ambiguidade de parsing de `-c -N`.
    let range = format!("{}:{}", n, n - 1);
    run_streaming_op(
        &app,
        "merge",
        &[
            "merge",
            "--non-interactive",
            "--accept",
            "postpone",
            "-r",
            &range,
            "--",
            &url,
            &path,
        ],
        None,
        mode,
    )
    .await
}

/// Edita o comentário (mensagem) de uma revisão no servidor
/// (`svn propset svn:log --revprop`). É uma alteração imediata e para todos — não
/// vira commit. Requer que o servidor permita revprop changes (hook
/// pre-revprop-change); sem ele, retorna erro (com dica amigável).
#[tauri::command]
pub async fn set_revprop_message(
    path: String,
    revision: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let n: i64 = revision
        .trim()
        .parse()
        .map_err(|_| "revisão inválida.".to_string())?;
    let (mode, cfg) = config_snapshot(&state);
    validate_local_path(&path, &cfg, "working copy", true, false)?;

    // Grava a mensagem num arquivo temporário e usa `-F`: robusto a mensagens
    // multilinha ou que comecem com '-' (o runner não expõe stdin).
    let tmp = std::env::temp_dir().join(format!(
        "subversa-revprop-{}-{}.txt",
        std::process::id(),
        next_op_id()
    ));
    std::fs::write(&tmp, message.as_bytes())
        .map_err(|e| format!("não consegui preparar a mensagem: {e}"))?;
    let tmp_s = tmp.to_string_lossy().to_string();
    let rev_s = n.to_string();

    let out = run(
        &[
            "propset",
            "svn:log",
            "--revprop",
            "-r",
            &rev_s,
            "--non-interactive",
            "-F",
            &tmp_s,
            "--",
            &path,
        ],
        None,
        mode,
    )
    .await;
    let _ = std::fs::remove_file(&tmp);
    out
}

#[tauri::command]
pub async fn resolve(
    path: String,
    accept: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    validate_resolve_accept(&accept)?;
    run(&["resolve", "--accept", &accept, "--", &path], None, mode).await
}

// ---------------------------------------------------------------------------
// Conflitos: editor de mesclagem em 3 painéis
// ---------------------------------------------------------------------------

/// Teto de tamanho por versão lida (base/mine/theirs). Acima disto, sem conteúdo:
/// o front cai nas opções rápidas em vez de tentar a mescla visual.
const CONFLICT_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Resolve o caminho de um sidecar relativo à pasta do arquivo em conflito.
fn sidecar_path(name: &str, parent: &Path) -> PathBuf {
    let p = Path::new(name);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        parent.join(p)
    }
}

/// Lê uma versão sidecar como texto. `(Some, false)` em sucesso; `(None, true)`
/// se for binário; `(None, false)` se grande demais ou ilegível (degrada para o
/// fallback em vez de derrubar o comando).
fn read_conflict_side(p: &Path) -> (Option<String>, bool) {
    let Ok(meta) = std::fs::metadata(p) else {
        return (None, false);
    };
    if meta.len() > CONFLICT_MAX_BYTES {
        return (None, false);
    }
    let Ok(bytes) = std::fs::read(p) else {
        return (None, false);
    };
    // NUL nos primeiros KB ⇒ binário (sem mescla de texto).
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return (None, true);
    }
    (Some(String::from_utf8_lossy(&bytes).into_owned()), false)
}

/// Extrai a revisão do nome do sidecar (`Foo.java.r130` → `130`,
/// `Foo.merge-right.r130` → `130`). `None` se não terminar em `.r<dígitos>`.
fn rev_from_sidecar(name: &str) -> Option<String> {
    let tail = name.rsplit(".r").next()?;
    if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) {
        Some(tail.to_string())
    } else {
        None
    }
}

/// Reúne as três versões (base/mine/theirs) de um arquivo em conflito, para o
/// editor de mesclagem em 3 painéis. Roda `svn info --xml` (independente de
/// idioma) e lê os arquivos sidecar que o SVN deixou ao lado do arquivo.
#[tauri::command]
pub async fn conflict_details(
    path: String,
    state: State<'_, AppState>,
) -> Result<ConflictDetails, String> {
    let (mode, cfg) = config_snapshot(&state);
    let abs = validate_local_path(&path, &cfg, "arquivo", false, false)?;
    let abs_str = abs.to_string_lossy().to_string();

    let info_xml = run_checked(&["info", "--xml", "--", &abs_str], None, mode).await?;
    let info = parser::parse_info(&info_xml)?;
    let entry = info
        .entries
        .into_iter()
        .next()
        .ok_or_else(|| "svn info não retornou dados".to_string())?;

    let parent = abs.parent().map(Path::to_path_buf).unwrap_or_default();
    let has_tree_conflict = entry.tree_conflict.is_some();
    let conflict = entry.conflict;
    let has_property_conflict = conflict
        .as_ref()
        .map(|c| c.prop_file.is_some())
        .unwrap_or(false);

    let side = |name: Option<&str>| -> (Option<String>, bool, Option<String>) {
        match name {
            Some(n) => {
                let (content, binary) = read_conflict_side(&sidecar_path(n, &parent));
                (content, binary, rev_from_sidecar(n))
            }
            None => (None, false, None),
        }
    };

    let (base, base_bin, base_rev) =
        side(conflict.as_ref().and_then(|c| c.prev_base_file.as_deref()));
    let (mine, mine_bin, _) = side(conflict.as_ref().and_then(|c| c.prev_wc_file.as_deref()));
    let (theirs, theirs_bin, theirs_rev) =
        side(conflict.as_ref().and_then(|c| c.cur_base_file.as_deref()));

    let binary = base_bin || mine_bin || theirs_bin;
    // Texto editável só quando temos as três versões legíveis.
    let is_text = base.is_some() && mine.is_some() && theirs.is_some();
    let kind = if is_text {
        "text"
    } else if has_tree_conflict {
        "tree"
    } else if has_property_conflict {
        "property"
    } else if conflict.is_some() {
        "text" // conflito de texto, mas binário/grande/ilegível → front faz fallback
    } else {
        "none"
    };

    let base_label = base_rev
        .map(|r| format!("Base (r{r})"))
        .unwrap_or_else(|| "Base".to_string());
    let theirs_label = theirs_rev
        .map(|r| format!("Servidor (r{r})"))
        .unwrap_or_else(|| "Servidor".to_string());

    Ok(ConflictDetails {
        path: abs_str,
        kind: kind.to_string(),
        binary,
        base,
        mine,
        theirs,
        base_label,
        theirs_label,
        has_tree_conflict,
        has_property_conflict,
    })
}

/// Escrita atômica: grava num temporário na mesma pasta e renomeia por cima.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = path.parent().ok_or("caminho sem diretório pai")?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "arquivo".into());
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.subversa.tmp.{}.{seq}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| format!("não consegui gravar o arquivo: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("não consegui gravar o arquivo: {e}")
    })
}

/// Grava o conteúdo mesclado no arquivo e marca o conflito como resolvido
/// (`svn resolve --accept working`). A gravação é atômica (temp + rename) para
/// nunca deixar o arquivo pela metade. O `content` já vem com o EOL correto.
#[tauri::command]
pub async fn resolve_with_content(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    let abs = validate_local_path(&path, &cfg, "arquivo", false, false)?;
    write_atomic(&abs, content.as_bytes())?;
    let abs_str = abs.to_string_lossy().to_string();
    run(
        &["resolve", "--accept", "working", "--", &abs_str],
        None,
        mode,
    )
    .await
}

#[tauri::command]
pub async fn cleanup(path: String, state: State<'_, AppState>) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run(&["cleanup", "--", &path], None, mode).await
}

#[tauri::command]
pub async fn delete_remote(
    url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_non_empty_message(&message)?;
    validate_remote_url_for_write(&url, &cfg)?;
    run_limited(
        &["delete", "--non-interactive", "-m", &message, "--", &url],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

/// Exporta uma URL (ou arquivo) para uma pasta local (`svn export`). Sem
/// versionamento — grava só em disco, então não pede confirmação de servidor.
/// `force` (`--force`) permite gravar em pasta não-vazia.
#[tauri::command]
pub async fn export_path(
    url: String,
    dest: String,
    force: bool,
    revision: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    let dest = validate_local_path(&dest, &cfg, "destino da exportação", true, false)?;
    let dest = dest.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["export".into(), "--non-interactive".into()];
    if force {
        args.push("--force".into());
    }
    if let Some(r) = revision.filter(|s| !s.trim().is_empty()) {
        args.push("-r".into());
        args.push(r);
    }
    args.push("--".into());
    args.push(url);
    args.push(dest);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_streaming_op(&app, "export", &refs, None, mode).await
}

/// Importa uma pasta local para uma URL do repositório (`svn import`).
#[tauri::command]
pub async fn import_path(
    local_path: String,
    url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_non_empty_message(&message)?;
    let local_path = validate_local_path(&local_path, &cfg, "pasta local a importar", false, true)?;
    validate_remote_url_for_write(&url, &cfg)?;
    let local_path = local_path.to_string_lossy().to_string();
    run_limited(
        &[
            "import",
            "--non-interactive",
            "-m",
            &message,
            "--",
            &local_path,
            &url,
        ],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

/// Cria uma pasta no repositório (`svn mkdir --parents`).
#[tauri::command]
pub async fn make_dir(
    url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_non_empty_message(&message)?;
    validate_remote_url_for_write(&url, &cfg)?;
    run_limited(
        &[
            "mkdir",
            "--parents",
            "--non-interactive",
            "-m",
            &message,
            "--",
            &url,
        ],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

/// Move/renomeia um nó no repositório (`svn move --parents`). Cobre tanto Mover
/// quanto Renomear (a diferença é só a URL de destino).
#[tauri::command]
pub async fn move_remote(
    src_url: String,
    dst_url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_non_empty_message(&message)?;
    validate_remote_url_for_write(&src_url, &cfg)?;
    validate_remote_url_for_write(&dst_url, &cfg)?;
    run_limited(
        &[
            "move",
            "--parents",
            "--non-interactive",
            "-m",
            &message,
            "--",
            &src_url,
            &dst_url,
        ],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    state
        .config
        .lock()
        .map(|c| c.clone())
        .map_err(|_| "config indisponível".into())
}

#[tauri::command]
pub fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    config::save(&config)?;
    if let Ok(mut g) = state.config.lock() {
        *g = config;
    }
    Ok(())
}

/// Config-modelo semeada a partir de um host SSH (ex.: `usuario@servidor`):
/// deriva `repo_base`, as raízes oficiais e os projetos-preset. Usada pela tela
/// de primeira execução para pré-popular tudo; não persiste nada (o frontend
/// revisa e chama `save_config`).
#[tauri::command]
pub fn preset_config(host: String) -> AppConfig {
    AppConfig::seeded_for(&host)
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/// Versão do cliente `svn` instalado.
#[tauri::command]
pub async fn svn_version(state: State<'_, AppState>) -> Result<String, String> {
    let mode = mode_of(&state);
    let v = run_checked(&["--version", "--quiet"], None, mode).await?;
    Ok(v.trim().to_string())
}

/// Verifica a presença dos binários externos exigidos em tempo de execução,
/// sem executá-los — distingue "fora do PATH" de outras falhas. Usado no boot
/// para avisar cedo (ex.: `svn` não instalado) em vez de só falhar na 1ª ação.
#[tauri::command]
pub fn check_prerequisites(state: State<'_, AppState>) -> Prerequisites {
    let mode = mode_of(&state);
    let has_pass = std::env::var("SSHPASS")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let sshpass_needed =
        matches!(mode, SshMode::Password) || (matches!(mode, SshMode::Auto) && has_pass);
    Prerequisites {
        svn_ok: super::conn::which("svn"),
        sshpass_ok: super::conn::which("sshpass"),
        sshpass_needed,
    }
}

/// Testa a conexão com o servidor consultando uma URL (info).
#[tauri::command]
pub async fn test_connection(
    url: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    parse_svn_url(&url, "URL SVN")?;
    run(&["info", "--non-interactive", "--", &url], None, mode).await
}

/// Dispara um processo de GUI externo sem bloquear nem deixar zumbis: silencia
/// os descritores padrão, coloca o filho em seu próprio grupo de processo (para
/// não receber sinais do app) e o reapeia numa thread dedicada (caso contrário
/// o processo terminado viraria `<defunct>` até o app fechar).
fn spawn_detached(mut cmd: std::process::Command) -> std::io::Result<()> {
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Abre um caminho no gerenciador de arquivos do sistema.
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_dir() {
        p
    } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    };
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(target);
    spawn_detached(cmd).map_err(|e| e.to_string())
}

/// Valida o nome de uma ferramenta externa: apenas um nome de binário simples
/// (sem caminho, espaços ou metacaracteres). Impede que o frontend dispare um
/// binário arbitrário via IPC (defesa adicional caso surja um XSS).
fn sanitize_tool(tool: &str) -> Option<String> {
    let t = tool.trim();
    let ok = !t.is_empty()
        && t.len() <= 64
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'));
    ok.then(|| t.to_string())
}

/// Abre uma ferramenta de diff externa (ex.: meld) na working copy.
///
/// A ferramenta vem da configuração do usuário (Ajustes), nunca de dados do
/// servidor. Validamos o formato (nome de binário simples) antes de executar.
#[tauri::command]
pub fn open_external_diff(
    target: String,
    tool: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let configured = state
        .config
        .lock()
        .map(|c| c.external_diff_tool.clone())
        .unwrap_or_default();
    let raw = match tool {
        Some(t) if !t.trim().is_empty() => t,
        _ => configured,
    };
    let raw = if raw.trim().is_empty() {
        "meld".to_string()
    } else {
        raw
    };
    let tool = sanitize_tool(&raw).ok_or_else(|| {
        format!("ferramenta de diff inválida: {raw:?} (use só o nome do binário, ex.: meld)")
    })?;
    let mut cmd = std::process::Command::new(&tool);
    cmd.arg(&target);
    spawn_detached(cmd).map_err(|e| format!("não consegui abrir {tool}: {e}"))
}

// ---------------------------------------------------------------------------
// Edição de arquivos da cópia de trabalho (editor embutido / externo)
// ---------------------------------------------------------------------------

/// Lê o conteúdo de um arquivo da cópia de trabalho (do disco) como texto UTF-8,
/// para edição no editor embutido. Diferente de [`cat_file`] (que lê a BASE do
/// SVN), este traz o estado ATUAL do arquivo — com as alterações locais. Recusa
/// binários e arquivos grandes demais; nesses casos a UI oferece o editor externo.
#[tauri::command]
pub async fn read_text_file(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let (_, cfg) = config_snapshot(&state);
    let abs = validate_local_path(&path, &cfg, "arquivo", false, false)?;
    let meta = std::fs::metadata(&abs).map_err(|e| format!("não consegui abrir o arquivo: {e}"))?;
    if meta.is_dir() {
        return Err("isto é uma pasta, não um arquivo.".into());
    }
    const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;
    if meta.len() > MAX_EDIT_BYTES {
        return Err(
            "arquivo grande demais para o editor embutido (acima de 5 MiB). Use o editor externo."
                .into(),
        );
    }
    let bytes = std::fs::read(&abs).map_err(|e| format!("não consegui ler o arquivo: {e}"))?;
    // Heurística de binário igual à do SVN: um byte NUL no começo indica binário.
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err(
            "arquivo binário — não dá para editar como texto. Use o editor externo.".into(),
        );
    }
    String::from_utf8(bytes)
        .map_err(|_| "o arquivo não é texto UTF-8 válido — use o editor externo.".to_string())
}

/// Grava o conteúdo editado de volta no arquivo da cópia de trabalho, de forma
/// atômica (temp + rename). NÃO toca no SVN: só altera o arquivo em disco — o
/// `svn status` volta como "modificado" e o usuário decide se commita. O `content`
/// já vem do editor com o EOL correto.
#[tauri::command]
pub async fn write_text_file(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (_, cfg) = config_snapshot(&state);
    let abs = validate_local_path(&path, &cfg, "arquivo", false, false)?;
    if !abs.is_file() {
        return Err("o arquivo não existe mais.".into());
    }
    write_atomic(&abs, content.as_bytes())
}

/// Abre um arquivo no editor de código externo configurado (Ajustes). Sem editor
/// definido, usa o aplicativo padrão do sistema (`xdg-open`). O nome do binário é
/// validado antes de executar (defesa contra IPC malicioso), como no diff externo.
#[tauri::command]
pub fn open_in_editor(
    path: String,
    editor: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let configured = state
        .config
        .lock()
        .map(|c| c.external_editor.clone())
        .unwrap_or_default();
    let raw = match editor {
        Some(t) if !t.trim().is_empty() => t,
        _ => configured,
    };
    let raw = raw.trim().to_string();
    if raw.is_empty() {
        // Sem editor configurado: abre no aplicativo padrão do sistema.
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&path);
        return spawn_detached(cmd).map_err(|e| format!("não consegui abrir o arquivo: {e}"));
    }
    let tool = sanitize_tool(&raw)
        .ok_or_else(|| format!("editor inválido: {raw:?} (use só o nome do binário, ex.: code)"))?;
    let mut cmd = std::process::Command::new(&tool);
    cmd.arg(&path);
    spawn_detached(cmd).map_err(|e| format!("não consegui abrir {tool}: {e}"))
}

// ---------------------------------------------------------------------------
// Registro de comandos (auditoria)
// ---------------------------------------------------------------------------

/// Histórico de comandos `svn` desta sessão (mais antigo → mais recente).
#[tauri::command]
pub fn get_command_log() -> Vec<CommandLogEntry> {
    super::audit::snapshot()
}

/// Limpa o histórico em memória (o arquivo de log permanece para auditoria).
#[tauri::command]
pub fn clear_command_log() {
    super::audit::clear();
}

/// Caminho do arquivo de log persistente (para abrir no gerenciador de arquivos).
#[tauri::command]
pub fn command_log_path() -> String {
    super::audit::path()
}

/// Diretório-base padrão sugerido na primeira execução (cwd se contiver WCs).
#[tauri::command]
pub fn suggested_base_dir() -> String {
    if let Ok(cwd) = std::env::current_dir() {
        if is_wc(&cwd) {
            return cwd
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.to_string_lossy().to_string());
        }
        if let Ok(rd) = std::fs::read_dir(&cwd) {
            let has_wc = rd
                .filter_map(|e| e.ok().map(|e| e.path()))
                .any(|p| p.is_dir() && is_wc(&p));
            if has_wc {
                return cwd.to_string_lossy().to_string();
            }
        }
    }
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validation_config() -> AppConfig {
        AppConfig {
            base_dir: std::env::temp_dir()
                .join(format!("subversa-validation-{}", std::process::id()))
                .to_string_lossy()
                .to_string(),
            repo_roots: vec!["svn+ssh://host/usr/svn/veiculo".into()],
            projects: vec![Project {
                key: "sna".into(),
                name: "SNA".into(),
                description: "SNA trunk".into(),
                url: "svn+ssh://host/usr/svn/getran/trunk/PROJETOS/sna".into(),
            }],
            ..AppConfig::default()
        }
    }

    #[test]
    fn remote_validation_accepts_urls_under_roots_and_projects() {
        let cfg = validation_config();

        validate_remote_url_for_read(
            "svn+ssh://host/usr/svn/veiculo/branches/ISSUES 2026/06 - JUNHO/issue_1234",
            &cfg,
        )
        .unwrap();

        validate_remote_url_for_write(
            "svn+ssh://host/usr/svn/getran/trunk/PROJETOS/sna/src/App.java",
            &cfg,
        )
        .unwrap();
    }

    #[test]
    fn remote_validation_rejects_out_of_scope_urls() {
        let cfg = validation_config();

        let err = validate_remote_url_for_read("svn+ssh://host/usr/svn/veiculo2/trunk", &cfg)
            .unwrap_err();
        assert!(err.contains("fora das localizações configuradas"));
    }

    #[test]
    fn remote_validation_rejects_invalid_scheme_and_empty_message() {
        let cfg = validation_config();

        let err =
            validate_remote_url_for_read("ssh://host/usr/svn/veiculo/trunk", &cfg).unwrap_err();
        assert!(err.contains("esquema de URL SVN inválido"));

        let err = validate_non_empty_message("  \n ").unwrap_err();
        assert!(err.contains("mensagem do commit"));
    }

    #[test]
    fn resolve_accept_rejects_unknown_value() {
        validate_resolve_accept("mine-full").unwrap();
        assert!(validate_resolve_accept("launch-editor").is_err());
    }

    #[test]
    fn local_destination_must_stay_inside_base_dir() {
        let cfg = validation_config();
        let base = PathBuf::from(&cfg.base_dir);
        std::fs::create_dir_all(&base).unwrap();

        let inside = base.join("checkout/sna");
        validate_local_path(
            inside.to_str().unwrap(),
            &cfg,
            "destino do checkout",
            true,
            false,
        )
        .unwrap();

        let outside = std::env::temp_dir().join(format!(
            "subversa-validation-outside-{}",
            std::process::id()
        ));
        let err = validate_local_path(
            outside.to_str().unwrap(),
            &cfg,
            "destino do checkout",
            true,
            false,
        )
        .unwrap_err();
        assert!(err.contains("destino fora da pasta de trabalho"));
    }
}
