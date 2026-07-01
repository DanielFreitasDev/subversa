//! Pontos de restauração (backup) das working copies.
//!
//! Antes de uma operação destrutiva (merge, update, switch, reverter), o app
//! pode tirar uma **cópia completa da pasta da working copy** (incluindo o
//! `.svn`) para um diretório de backups. Restaurar reescreve a working copy com
//! essa cópia — voltando ao estado exato anterior, "como se nada tivesse
//! acontecido". A cópia é fiel de propósito: só assim recuperamos pristine,
//! mergeinfo, conflitos e modificações locais de uma vez.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, State};

use super::cancel::{self, CancelToken};
use super::commands::{
    config_snapshot, emit_op_progress, is_wc, next_op_id, validate_local_path, PROGRESS_INTERVAL,
};
use super::types::{AppConfig, BackupEntry, CommandOutput};
use crate::AppState;

/// Acumulador de progresso/tamanho durante a cópia recursiva.
struct CopyStats {
    bytes: u64,
    files: u64,
}

/// Raiz dos backups: `cfg.backup_dir` se preenchido, senão
/// `~/.cache/subversa/backups`. Cria a pasta se preciso.
fn backups_root(cfg: &AppConfig) -> Result<PathBuf, String> {
    let dir = if cfg.backup_dir.trim().is_empty() {
        dirs::cache_dir()
            .ok_or("não consegui localizar o diretório de cache para os backups.")?
            .join("subversa")
            .join("backups")
    } else {
        PathBuf::from(cfg.backup_dir.trim())
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("não consegui criar a pasta de backups: {e}"))?;
    Ok(dir)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Substitui qualquer caractere fora de `[A-Za-z0-9-_]` por `_`, para compor um
/// `id`/nome de pasta seguro a partir do nome da working copy.
fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Valida o formato de um `id` de backup vindo do frontend (evita travessia de
/// caminho: o `id` é usado como nome de pasta sob a raiz dos backups).
fn validate_id(id: &str) -> Result<(), String> {
    let bad = id.is_empty()
        || id.len() > 200
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0');
    if bad {
        Err("identificador de backup inválido.".into())
    } else {
        Ok(())
    }
}

/// Resolve (e valida) a pasta de um backup pelo `id`.
fn backup_dir_for(root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let dir = root.join(id);
    if !dir.is_dir() {
        return Err("backup não encontrado (talvez já tenha sido excluído).".into());
    }
    Ok(dir)
}

/// Defesa adicional contra restaurar sobre um caminho perigoso (raiz/home).
fn guard_target(p: &Path) -> Result<(), String> {
    if p.components().count() < 3 {
        return Err("destino de restauração inseguro (caminho raso demais).".into());
    }
    Ok(())
}

fn read_meta(dir: &Path) -> Option<BackupEntry> {
    let text = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Lê todos os backups da raiz (com a pasta de cada um), ordenados do mais
/// recente para o mais antigo.
fn read_all(root: &Path) -> Vec<(BackupEntry, PathBuf)> {
    let mut out: Vec<(BackupEntry, PathBuf)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if let Some(m) = read_meta(&p) {
                    out.push((m, p));
                }
            }
        }
    }
    out.sort_by_key(|(m, _)| std::cmp::Reverse(m.created_ms));
    out
}

/// Copia recursivamente o conteúdo de `src` para `dst`, chamando `on_file` a cada
/// arquivo (para o progresso) e somando tamanho/contagem em `stats`. Symlinks são
/// recriados (não seguidos). Bloqueante — chamada dentro de `spawn_blocking`.
/// `cancel` interrompe entre uma entrada e outra (nunca no meio de um arquivo).
fn copy_tree(
    src: &Path,
    dst: &Path,
    on_file: &mut dyn FnMut(u64, &Path),
    stats: &mut CopyStats,
    cancel: &CancelToken,
) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("não consegui criar {}: {e}", dst.display()))?;
    let rd =
        std::fs::read_dir(src).map_err(|e| format!("não consegui ler {}: {e}", src.display()))?;
    for entry in rd {
        if cancel.is_cancelled() {
            return Err(cancel::CANCELLED_MSG.into());
        }
        let entry = entry.map_err(|e| format!("falha ao listar {}: {e}", src.display()))?;
        let ft = entry
            .file_type()
            .map_err(|e| format!("falha ao inspecionar {}: {e}", entry.path().display()))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_tree(&from, &to, on_file, stats, cancel)?;
        } else if ft.is_symlink() {
            #[cfg(unix)]
            {
                let target = std::fs::read_link(&from)
                    .map_err(|e| format!("falha ao ler symlink {}: {e}", from.display()))?;
                let _ = std::fs::remove_file(&to);
                std::os::unix::fs::symlink(&target, &to)
                    .map_err(|e| format!("falha ao recriar symlink {}: {e}", to.display()))?;
            }
            stats.files += 1;
            on_file(stats.files, &from);
        } else {
            let n = std::fs::copy(&from, &to)
                .map_err(|e| format!("falha ao copiar {}: {e}", from.display()))?;
            stats.bytes += n;
            stats.files += 1;
            on_file(stats.files, &from);
        }
    }
    Ok(())
}

/// Roda `copy_tree` numa thread bloqueante, emitindo `op-progress` (`op`) com
/// throttle e um evento final `done`. Devolve as estatísticas da cópia.
async fn copy_with_progress(
    app: &AppHandle,
    op: &'static str,
    src: PathBuf,
    dst: PathBuf,
) -> Result<CopyStats, String> {
    let op_id = next_op_id();
    // Cancelável pelo mesmo `id` do op-progress; o token (clonado) viaja para a
    // thread bloqueante e é checado a cada entrada copiada.
    let guard = cancel::register(op_id);
    let token = guard.token().clone();
    emit_op_progress(app, op_id, op, 0, "", false);
    let emitter = app.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<CopyStats, String> {
        let mut last = Instant::now();
        let mut stats = CopyStats { bytes: 0, files: 0 };
        {
            let mut on_file = |count: u64, p: &Path| {
                let now = Instant::now();
                if now.duration_since(last) >= PROGRESS_INTERVAL {
                    last = now;
                    emit_op_progress(&emitter, op_id, op, count, &p.to_string_lossy(), false);
                }
            };
            copy_tree(&src, &dst, &mut on_file, &mut stats, &token)?;
        }
        Ok(stats)
    })
    .await
    .map_err(|e| format!("a tarefa de cópia falhou: {e}"))?;

    // Evento final (também em erro) para a UI remover o cartão de progresso.
    let count = result.as_ref().map(|s| s.files).unwrap_or(0);
    emit_op_progress(app, op_id, op, count, "", true);
    result
}

/// Remove os backups da mesma working copy além dos `keep` mais recentes.
/// `keep == 0` desativa a poda (mantém tudo).
fn prune(root: &Path, wc_path: &str, keep: u32) {
    if keep == 0 {
        return;
    }
    let mut same: Vec<(BackupEntry, PathBuf)> = read_all(root)
        .into_iter()
        .filter(|(m, _)| m.wc_path == wc_path)
        .collect();
    if same.len() > keep as usize {
        for (_, dir) in same.split_off(keep as usize) {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

/// Metadados descritivos do backup, vindos do frontend (que já tem a
/// `WorkingCopy`). Servem só para exibição — o que protege é a cópia em si.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub path: String,
    pub op: String,
    pub name: String,
    pub url: String,
    pub revision: String,
    pub branch_label: String,
}

/// Cria um ponto de restauração da working copy `req.path`.
#[tauri::command]
pub async fn create_backup(
    req: BackupRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BackupEntry, String> {
    let (_, cfg) = config_snapshot(&state);
    let abs = validate_local_path(&req.path, &cfg, "working copy", true, true)?;
    if !is_wc(&abs) {
        return Err("a pasta não é uma working copy do SVN.".into());
    }
    let abs_str = abs.to_string_lossy().to_string();

    let root = backups_root(&cfg)?;
    // A pasta de backups não pode estar dentro da própria working copy (a cópia
    // recursiva entraria nela mesma).
    if root.starts_with(&abs) {
        return Err(
            "a pasta de backups está dentro da working copy. Escolha outra pasta em Configurações."
                .into(),
        );
    }

    let created = now_ms();
    let id = format!("{}-{}-{}", sanitize(&req.name), created, next_op_id());
    let dir = root.join(&id);
    let data = dir.join("data");
    std::fs::create_dir_all(&data)
        .map_err(|e| format!("não consegui criar a pasta do backup: {e}"))?;

    let stats = match copy_with_progress(&app, "backup", abs.clone(), data.clone()).await {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir); // limpa o backup parcial
            return Err(e);
        }
    };

    let entry = BackupEntry {
        id,
        wc_path: abs_str,
        wc_name: req.name,
        op: req.op,
        url: req.url,
        branch_label: req.branch_label,
        revision: req.revision,
        created_ms: created,
        size_bytes: stats.bytes,
        file_count: stats.files,
    };
    let meta = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("meta.json"), meta).map_err(|e| {
        let _ = std::fs::remove_dir_all(&dir);
        format!("não consegui gravar os metadados do backup: {e}")
    })?;

    prune(&root, &entry.wc_path, cfg.backup_keep);
    Ok(entry)
}

/// Lista todos os pontos de restauração (mais recentes primeiro).
#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupEntry>, String> {
    let (_, cfg) = config_snapshot(&state);
    let root = backups_root(&cfg)?;
    Ok(read_all(&root).into_iter().map(|(m, _)| m).collect())
}

/// Restaura um backup: apaga o conteúdo atual da working copy e copia a cópia de
/// volta. Reescreve a pasta inteira — daí o confirm com digitação no frontend.
#[tauri::command]
pub async fn restore_backup(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let (_, cfg) = config_snapshot(&state);
    let root = backups_root(&cfg)?;
    let dir = backup_dir_for(&root, &id)?;
    let meta = read_meta(&dir).ok_or("backup sem metadados válidos.")?;
    let data = dir.join("data");
    if !data.is_dir() {
        return Err("os dados do backup não foram encontrados.".into());
    }

    // Caminho absoluto e plausível (não exige estar na base_dir atual: ela pode
    // ter mudado desde o backup).
    let target = validate_local_path(&meta.wc_path, &cfg, "working copy de destino", false, false)?;
    guard_target(&target)?;

    // Limpeza + recriação acontecem dentro do spawn_blocking da cópia.
    let target_clone = target.clone();
    let prep = tokio::task::spawn_blocking(move || -> Result<(), String> {
        if target_clone.exists() {
            std::fs::remove_dir_all(&target_clone)
                .map_err(|e| format!("não consegui limpar a working copy: {e}"))?;
        }
        std::fs::create_dir_all(&target_clone)
            .map_err(|e| format!("não consegui recriar a working copy: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("a preparação da restauração falhou: {e}"))?;
    prep?;

    let stats = copy_with_progress(&app, "restore", data, target)
        .await
        .map_err(|e| {
            if e.starts_with(cancel::CANCELLED_MSG) {
                format!("{e}\n\nA restauração foi interrompida e a working copy ficou INCOMPLETA — restaure este backup novamente para deixá-la íntegra.")
            } else {
                e
            }
        })?;

    Ok(CommandOutput {
        success: true,
        code: Some(0),
        stdout: format!(
            "Backup restaurado: {} arquivos copiados de volta para {}.",
            stats.files, meta.wc_path
        ),
        stderr: String::new(),
        hint: None,
        command: format!("restaurar backup {id}"),
    })
}

/// Exclui um ponto de restauração.
#[tauri::command]
pub fn delete_backup(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (_, cfg) = config_snapshot(&state);
    let root = backups_root(&cfg)?;
    let dir = backup_dir_for(&root, &id)?;
    std::fs::remove_dir_all(&dir).map_err(|e| format!("não consegui excluir o backup: {e}"))
}

/// Caminho da pasta de backups (para abrir no gerenciador de arquivos).
#[tauri::command]
pub fn backups_dir(state: State<'_, AppState>) -> Result<String, String> {
    let (_, cfg) = config_snapshot(&state);
    Ok(backups_root(&cfg)?.to_string_lossy().to_string())
}
