//! Prateleira ("guardar para depois"): shelves NOMEADOS e PERSISTENTES de
//! alterações locais — o equivalente, em espírito, ao stash do Git.
//!
//! Guardar captura o conteúdo dos arquivos selecionados (blobs fiéis byte a
//! byte, qualquer codificação), LIMPA essas mudanças da working copy e grava
//! tudo em `~/.local/share/subversa/shelves/<id>/` (meta.json + blobs).
//! Aplicar de volta reescreve os conteúdos e re-agenda add/delete — a mesma
//! mecânica do desfazer (`undo.rs`), mas com nome, durável entre sessões e
//! aplicável quando o usuário quiser.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::backup::{now_ms, sanitize, validate_id};
use super::commands::{config_snapshot, next_op_id, peg_safe, validate_local_path};
use super::runner::run;
use super::types::{CommandOutput, ShelfEntry};
use super::undo::status_of;
use crate::AppState;

/// Raiz dos shelves. Dados do usuário (não cache): sobrevivem a limpezas e a
/// reinícios — diferente dos blobs de desfazer, que são descartáveis.
fn shelves_root() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or("não consegui localizar o diretório de dados do usuário.")?
        .join("subversa")
        .join("shelves");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("não consegui criar a pasta de guardados: {e}"))?;
    Ok(dir)
}

/// Um arquivo capturado no shelf (o `StashedFile` do undo, serializado).
#[derive(Serialize, Deserialize)]
struct ShelfFile {
    /// Caminho absoluto do arquivo na working copy.
    target: String,
    /// Nome do blob dentro da pasta do shelf (`None` = não existia em disco).
    blob: Option<String>,
    /// Status svn no momento de guardar (define como reaplicar).
    status: String,
}

#[derive(Serialize, Deserialize)]
struct ShelfMeta {
    entry: ShelfEntry,
    files: Vec<ShelfFile>,
}

fn read_meta(dir: &Path) -> Option<ShelfMeta> {
    let text = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Guarda as mudanças de `paths` sob um `name`: captura blobs + status svn,
/// grava o shelf em disco e SÓ ENTÃO limpa a working copy (revert + remoção dos
/// arquivos novos). Se a limpeza falhar, o shelf é mantido (os blobs protegem).
#[tauri::command]
pub async fn shelve(
    wc_path: String,
    paths: Vec<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<ShelfEntry, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_local_path(&wc_path, &cfg, "working copy", true, false)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("dê um nome ao guardado (ex.: “ajuste do relatório”).".into());
    }
    if paths.is_empty() {
        return Err("selecione ao menos um arquivo para guardar.".into());
    }

    let status = status_of(&paths, mode).await;
    let status_de = |p: &str| -> String {
        status
            .iter()
            .find(|(path, _)| path == p)
            .map(|(_, item)| item.clone())
            .unwrap_or_else(|| "modified".into())
    };

    let created = now_ms();
    let id = format!("{}-{}-{}", sanitize(&name), created, next_op_id());
    let dir = shelves_root()?.join(&id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("não consegui criar a pasta do guardado: {e}"))?;

    // Captura os conteúdos atuais (blobs fiéis, qualquer codificação).
    let mut files: Vec<ShelfFile> = Vec::new();
    let mut size_bytes: u64 = 0;
    for (i, p) in paths.iter().enumerate() {
        let Ok(tgt) = validate_local_path(p, &cfg, "arquivo", true, false) else {
            continue;
        };
        let blob = if tgt.is_file() {
            let blob_name = format!("{i}.blob");
            match std::fs::copy(&tgt, dir.join(&blob_name)) {
                Ok(n) => {
                    size_bytes += n;
                    Some(blob_name)
                }
                Err(_) => None,
            }
        } else {
            None
        };
        files.push(ShelfFile {
            target: tgt.to_string_lossy().to_string(),
            blob,
            status: status_de(p),
        });
    }
    if files.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("nenhum arquivo capturável para guardar.".into());
    }

    let entry = ShelfEntry {
        id,
        name,
        wc_name: PathBuf::from(&wc_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        wc_path,
        created_ms: created,
        file_count: files.len() as u32,
        size_bytes,
    };
    let meta = ShelfMeta {
        entry: entry.clone(),
        files,
    };
    let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("meta.json"), text).map_err(|e| {
        let _ = std::fs::remove_dir_all(&dir);
        format!("não consegui gravar o guardado: {e}")
    })?;

    // Shelf salvo — agora limpa a WC: reverte as mudanças versionadas…
    let mut args: Vec<String> = vec!["revert".into(), "--non-interactive".into()];
    args.push("--".into());
    args.extend(meta.files.iter().map(|f| peg_safe(&f.target)));
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run(&refs, None, mode).await?;
    if !out.success {
        let mut msg = out.stderr.trim().to_string();
        if let Some(h) = out.hint {
            msg.push_str("\n\n");
            msg.push_str(&h);
        }
        return Err(format!(
            "o conteúdo foi guardado, mas não consegui limpar a working copy: {msg}"
        ));
    }
    // …e tira do disco o que o revert não tira (arquivos novos/não versionados).
    for f in &meta.files {
        if matches!(f.status.as_str(), "added" | "unversioned") {
            let _ = std::fs::remove_file(&f.target);
        }
    }

    Ok(entry)
}

/// Lista todos os guardados (mais recentes primeiro). O frontend filtra por WC.
#[tauri::command]
pub fn list_shelves() -> Result<Vec<ShelfEntry>, String> {
    let root = shelves_root()?;
    let mut out: Vec<ShelfEntry> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                if let Some(m) = read_meta(&e.path()) {
                    out.push(m.entry);
                }
            }
        }
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.created_ms));
    Ok(out)
}

/// Aplica um guardado de volta na working copy (conteúdo + agendamento svn) e o
/// exclui em caso de sucesso — como o `stash pop` do Git.
#[tauri::command]
pub async fn unshelve(id: String, state: State<'_, AppState>) -> Result<CommandOutput, String> {
    let (mode, _) = config_snapshot(&state);
    validate_id(&id)?;
    let dir = shelves_root()?.join(&id);
    let meta = read_meta(&dir).ok_or("guardado não encontrado (talvez já tenha sido aplicado).")?;

    let mut restored = 0u32;
    let mut to_add: Vec<String> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for f in &meta.files {
        // Reescreve o conteúdo guardado por cima do atual (o confirm da UI já
        // avisou que mudanças feitas depois de guardar serão sobrescritas).
        let mut write_blob = || -> bool {
            match &f.blob {
                Some(b) => match std::fs::copy(dir.join(b), &f.target) {
                    Ok(_) => true,
                    Err(e) => {
                        warnings.push(format!("{}: {e}", f.target));
                        false
                    }
                },
                None => false,
            }
        };
        match f.status.as_str() {
            // Era novo (agendado): reescreve e re-agenda a adição.
            "added" => {
                if write_blob() {
                    restored += 1;
                }
                to_add.push(f.target.clone());
            }
            // Fora do SVN: basta voltar o arquivo para o disco.
            "unversioned" => {
                if write_blob() {
                    restored += 1;
                }
            }
            // Estava agendado para exclusão: re-agenda (`--force` tira do disco).
            "deleted" => to_delete.push(f.target.clone()),
            // Estava sumido do disco: volta a sumir.
            "missing" => {
                let _ = std::fs::remove_file(&f.target);
            }
            // Modificado/substituído/etc.: reescreve o conteúdo guardado.
            _ => {
                if write_blob() {
                    restored += 1;
                }
            }
        }
    }

    if !to_add.is_empty() {
        let targets: Vec<String> = to_add.iter().map(|p| peg_safe(p)).collect();
        let mut args: Vec<&str> = vec!["add", "--force", "--parents", "--"];
        args.extend(targets.iter().map(|s| s.as_str()));
        if let Ok(out) = run(&args, None, mode).await {
            if !out.success {
                warnings.push(out.stderr.trim().to_string());
            }
        }
    }
    if !to_delete.is_empty() {
        let targets: Vec<String> = to_delete.iter().map(|p| peg_safe(p)).collect();
        let mut args: Vec<&str> = vec!["delete", "--force", "--"];
        args.extend(targets.iter().map(|s| s.as_str()));
        if let Ok(out) = run(&args, None, mode).await {
            if !out.success {
                warnings.push(out.stderr.trim().to_string());
            } else {
                restored += to_delete.len() as u32;
            }
        }
    }

    // Aplicado com sucesso: o guardado foi consumido.
    let _ = std::fs::remove_dir_all(&dir);

    let warnings: Vec<String> = warnings.into_iter().filter(|w| !w.is_empty()).collect();
    Ok(CommandOutput {
        success: true,
        code: Some(0),
        stdout: format!(
            "{restored} item(ns) de “{}” aplicados de volta.",
            meta.entry.name
        ),
        stderr: String::new(),
        hint: if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("\n"))
        },
        command: format!("aplicar guardado {id}"),
    })
}

/// Exclui um guardado sem aplicá-lo.
#[tauri::command]
pub fn delete_shelf(id: String) -> Result<(), String> {
    validate_id(&id)?;
    let dir = shelves_root()?.join(&id);
    if !dir.is_dir() {
        return Err("guardado não encontrado (talvez já tenha sido excluído).".into());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("não consegui excluir o guardado: {e}"))
}
