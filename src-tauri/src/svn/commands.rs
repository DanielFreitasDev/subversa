//! Comandos Tauri expostos ao frontend.
//!
//! Cada operação do fluxo SVN do usuário tem aqui um comando dedicado. Os que
//! escrevem no servidor devolvem [`CommandOutput`] (sucesso + stdout/stderr +
//! dica), para que a UI possa mostrar o resultado mesmo em caso de erro.

use std::path::{Path, PathBuf};

use tauri::State;

use super::parser;
use super::runner::{run, run_checked};
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
                "modified" | "added" | "deleted" | "replaced" | "missing" | "obstructed"
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
    let mut args = vec!["status", "--xml"];
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
    let mode = mode_of(&state);
    let change = format!("-c{}", revision.trim());
    let mut args: Vec<&str> = vec!["diff", "--internal-diff", change.as_str()];
    if ignore_ws {
        args.push("-x");
        args.push("-w");
    }
    args.push("--");
    args.push(target.as_str());
    run_checked(&args, None, mode).await
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
    let mode = mode_of(&state);
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
    let xml = run_checked(&refs, None, mode).await?;
    parser::parse_log(&xml)
}

/// Lista o conteúdo de uma URL no repositório (navegador de branches).
#[tauri::command]
pub async fn list_dir(url: String, state: State<'_, AppState>) -> Result<Vec<ListEntry>, String> {
    let mode = mode_of(&state);
    let xml = run_checked(&["list", "--xml", "--non-interactive", "--", &url], None, mode).await?;
    parser::parse_list(&xml)
}

/// Conteúdo de um arquivo do servidor/revisão (`svn cat`).
#[tauri::command]
pub async fn cat_file(
    target: String,
    revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mode = mode_of(&state);
    let mut args: Vec<String> = vec!["cat".into(), "--non-interactive".into()];
    if let Some(r) = revision {
        args.push("-r".into());
        args.push(r);
    }
    args.push("--".into());
    args.push(target);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_checked(&refs, None, mode).await
}

/// Autoria por linha (`svn blame`) combinada com o conteúdo (`svn cat`).
#[tauri::command]
pub async fn blame(target: String, state: State<'_, AppState>) -> Result<Vec<BlameLine>, String> {
    let mode = mode_of(&state);
    let xml = run_checked(&["blame", "--xml", "--non-interactive", "--", &target], None, mode).await?;
    let content = run_checked(&["cat", "--non-interactive", "--", &target], None, mode)
        .await
        .unwrap_or_default();
    parser::parse_blame(&xml, &content)
}

/// `svn info` de uma URL remota → [`UrlInfo`] (revisão no breadcrumb/painel e
/// validação de localização no navegador de repositórios).
#[tauri::command]
pub async fn get_url_info(url: String, state: State<'_, AppState>) -> Result<UrlInfo, String> {
    let mode = mode_of(&state);
    let xml = run_checked(&["info", "--xml", "--non-interactive", "--", &url], None, mode).await?;
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
    let mode = mode_of(&state);
    let mut args: Vec<&str> = vec!["diff", "--internal-diff", "--non-interactive"];
    if ignore_ws {
        args.push("-x");
        args.push("-w");
    }
    args.push("--old");
    args.push(old_url.as_str());
    args.push("--new");
    args.push(new_url.as_str());
    run_checked(&args, None, mode).await
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
    let mode = mode_of(&state);
    run(&["checkout", "--non-interactive", "--", &url, &dest], None, mode).await
}

#[tauri::command]
pub async fn update(path: String, state: State<'_, AppState>) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run(
        &["update", "--non-interactive", "--accept", "postpone", "--", &path],
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
    if message.trim().is_empty() {
        return Err("a mensagem do commit não pode ser vazia".into());
    }
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
    let mode = mode_of(&state);
    run(
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
    )
    .await
}

#[tauri::command]
pub async fn switch_wc(
    path: String,
    url: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run(
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
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
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
    run(&refs, None, mode).await
}

#[tauri::command]
pub async fn resolve(
    path: String,
    accept: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
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
    let mode = mode_of(&state);
    run(
        &["delete", "--non-interactive", "-m", &message, "--", &url],
        None,
        mode,
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
    let mode = mode_of(&state);
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
    run(&refs, None, mode).await
}

/// Importa uma pasta local para uma URL do repositório (`svn import`).
#[tauri::command]
pub async fn import_path(
    local_path: String,
    url: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    if message.trim().is_empty() {
        return Err("a mensagem do commit não pode ser vazia".into());
    }
    let mode = mode_of(&state);
    run(
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
    if message.trim().is_empty() {
        return Err("a mensagem do commit não pode ser vazia".into());
    }
    let mode = mode_of(&state);
    run(
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
    if message.trim().is_empty() {
        return Err("a mensagem do commit não pode ser vazia".into());
    }
    let mode = mode_of(&state);
    run(
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

/// Testa a conexão com o servidor consultando uma URL (info).
#[tauri::command]
pub async fn test_connection(
    url: String,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let mode = mode_of(&state);
    run(&["info", "--non-interactive", "--", &url], None, mode).await
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
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
    std::process::Command::new(&tool)
        .arg(&target)
        .spawn()
        .map_err(|e| format!("não consegui abrir {tool}: {e}"))?;
    Ok(())
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
