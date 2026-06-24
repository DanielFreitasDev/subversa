//! Comandos Tauri expostos ao frontend.
//!
//! Cada operação do fluxo SVN do usuário tem aqui um comando dedicado. Os que
//! escrevem no servidor devolvem [`CommandOutput`] (sucesso + stdout/stderr +
//! dica), para que a UI possa mostrar o resultado mesmo em caso de erro.

use std::path::{Path, PathBuf};

use tauri::State;
use url::Url;

use super::parser;
use super::runner::{
    run, run_checked, run_checked_limited, run_limited, LIMIT_BLAME, LIMIT_CAT_FILE, LIMIT_DEFAULT,
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
fn config_snapshot(state: &State<AppState>) -> (SshMode, AppConfig) {
    match state.config.lock() {
        Ok(c) => (c.ssh_mode, c.clone()),
        Err(_) => (SshMode::Auto, AppConfig::default()),
    }
}

fn is_wc(path: &Path) -> bool {
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

fn validate_local_path(
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
/// `ignore_ws` adiciona `-x -w` (ignora diferenças de espaço em branco).
#[tauri::command]
pub async fn get_diff(
    path: String,
    files: Option<Vec<String>>,
    ignore_ws: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["diff".into(), "--internal-diff".into()];
    if ignore_ws {
        args.push("-x".into());
        args.push("-w".into());
    }
    args.push("--".into());
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
/// "Sem diferenças.". `ignore_ws` adiciona `-x -w`.
#[tauri::command]
pub async fn diff_revision(
    target: String,
    revision: String,
    ignore_ws: bool,
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
    let mut args: Vec<&str> = vec![
        "diff",
        "--internal-diff",
        "--non-interactive",
        change.as_str(),
    ];
    if ignore_ws {
        args.push("-x");
        args.push("-w");
    }
    args.push("--");
    args.push(target.as_str());
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
/// argumento. `ignore_ws` adiciona `-x -w`.
#[tauri::command]
pub async fn diff_urls(
    old_url: String,
    new_url: String,
    ignore_ws: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&old_url, &cfg)?;
    validate_remote_url_for_read(&new_url, &cfg)?;
    let mut args: Vec<&str> = vec!["diff", "--internal-diff", "--non-interactive"];
    if ignore_ws {
        args.push("-x");
        args.push("-w");
    }
    args.push("--old");
    args.push(old_url.as_str());
    args.push("--new");
    args.push(new_url.as_str());
    run_checked_limited(&args, None, mode, LIMIT_DEFAULT).await
}

// ---------------------------------------------------------------------------
// Operações que escrevem (servidor ou WC)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn checkout(
    url: String,
    dest: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    let dest = validate_local_path(&dest, &cfg, "destino do checkout", true, false)?;
    let dest = dest.to_string_lossy().to_string();
    run_limited(
        &["checkout", "--non-interactive", "--", &url, &dest],
        None,
        mode,
        LIMIT_DEFAULT,
    )
    .await
}

#[tauri::command]
pub async fn update(path: String, state: State<'_, AppState>) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run(
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

#[tauri::command]
pub async fn remove(
    paths: Vec<String>,
    keep_local: bool,
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
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_remote_url_for_read(&url, &cfg)?;
    validate_local_path(&path, &cfg, "working copy", true, false)?;
    run_limited(
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
        LIMIT_DEFAULT,
    )
    .await
}

#[tauri::command]
pub async fn merge(
    path: String,
    source_url: String,
    dry_run: bool,
    record_only: bool,
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
    run_limited(&refs, None, mode, LIMIT_DEFAULT).await
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
    run_limited(&refs, None, mode, LIMIT_DEFAULT).await
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
