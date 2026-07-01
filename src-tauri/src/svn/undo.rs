//! Pilha de **desfazer** (Ctrl+Z) das reversões.
//!
//! Antes de QUALQUER reversão (trecho, arquivo, selecionados ou tudo), o frontend
//! pede um *stash*: copiamos o conteúdo atual de cada arquivo afetado para uma
//! pasta temporária e guardamos o status svn de cada um. Desfazer reescreve os
//! arquivos de volta e reaplica o agendamento (add/delete) — trazendo de volta
//! exatamente o que a reversão acabou de descartar.
//!
//! É leve e por-arquivo, ao contrário do *ponto de restauração* (`backup.rs`),
//! que copia a working copy inteira (incluindo `.svn`). Aqui o objetivo é um
//! desfazer imediato e barato logo após reverter, não um histórico durável: a
//! pilha vive só em memória (some ao fechar o app) e os blobs ficam no cache.

use std::path::{Path, PathBuf};

use tauri::State;

use super::commands::{config_snapshot, next_op_id, validate_local_path};
use super::parser;
use super::runner::run;
use super::types::{CommandOutput, StashResult};
use crate::AppState;

/// Quantos pontos de desfazer manter em memória (e em disco). Além disso, os
/// mais antigos são descartados (com seus blobs).
const KEEP: usize = 20;

/// Um arquivo capturado antes da reversão.
struct StashedFile {
    /// Caminho absoluto do arquivo na working copy.
    target: PathBuf,
    /// Onde o conteúdo de antes foi salvo (`None` = o arquivo não existia em
    /// disco antes de reverter, ex.: estava agendado para exclusão).
    blob: Option<PathBuf>,
    /// Status svn de antes da reversão (`modified`, `added`, `deleted`,
    /// `missing`, ...) — define como reaplicar o agendamento ao desfazer.
    status: String,
}

/// Um ponto de desfazer: tudo o que foi capturado antes de uma reversão.
struct UndoEntry {
    id: u64,
    /// Pasta temporária com os blobs deste ponto.
    dir: PathBuf,
    files: Vec<StashedFile>,
}

/// Pilha de desfazer global (vive no [`AppState`]).
#[derive(Default)]
pub struct UndoStore {
    entries: Vec<UndoEntry>,
}

/// Raiz dos blobs de desfazer: `~/.cache/subversa/undo`.
fn undo_root() -> Result<PathBuf, String> {
    let dir = dirs::cache_dir()
        .ok_or("não consegui localizar o diretório de cache.")?
        .join("subversa")
        .join("undo");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("não consegui criar a pasta de desfazer: {e}"))?;
    Ok(dir)
}

/// Limpa os blobs órfãos no disco. Chamado na inicialização: a pilha em memória
/// recomeça vazia, então qualquer blob de uma sessão anterior é lixo.
pub fn clear_disk() {
    if let Ok(dir) = undo_root() {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

/// Status svn (campo `item`) de cada caminho, por `svn status --xml`. Caminhos
/// em estado normal não aparecem na saída — o chamador assume um padrão. Em caso
/// de falha, devolve vazio (o chamador cai no padrão para todos).
async fn status_of(paths: &[String], mode: super::types::SshMode) -> Vec<(String, String)> {
    let mut args: Vec<&str> = vec!["status", "--xml", "--"];
    args.extend(paths.iter().map(|s| s.as_str()));
    let xml = match run(&args, None, mode).await {
        Ok(out) if out.success => out.stdout,
        _ => return Vec::new(),
    };
    match parser::parse_status(&xml, Path::new("/"), |p| p.is_dir()) {
        Ok(res) => res.entries.into_iter().map(|e| (e.path, e.item)).collect(),
        Err(_) => Vec::new(),
    }
}

/// Captura o estado atual dos `paths` antes de uma reversão e devolve um `id`
/// para desfazer depois. `id == 0` significa que não há nada a desfazer (lista
/// vazia ou nenhum arquivo capturável) — o frontend então não oferece o desfazer.
#[tauri::command]
pub async fn stash_revert(
    wc_path: String,
    paths: Vec<String>,
    label: String,
    state: State<'_, AppState>,
) -> Result<StashResult, String> {
    let (mode, cfg) = config_snapshot(&state);
    validate_local_path(&wc_path, &cfg, "working copy", true, false)?;
    if paths.is_empty() {
        return Ok(StashResult {
            id: 0,
            file_count: 0,
            label,
        });
    }

    let status = status_of(&paths, mode).await;
    let status_of_path = |p: &str| -> String {
        status
            .iter()
            .find(|(path, _)| path == p)
            .map(|(_, item)| item.clone())
            .unwrap_or_else(|| "modified".into())
    };

    let id = next_op_id();
    let dir = undo_root()?.join(format!("{}-{}", std::process::id(), id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui preparar o desfazer: {e}"))?;

    let mut files = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        let tgt = match validate_local_path(p, &cfg, "arquivo", true, false) {
            Ok(t) => t,
            Err(_) => continue,
        };
        // Copia o conteúdo atual (se houver) preservando os bytes — fiel a
        // qualquer codificação, ao contrário de um patch de texto.
        let blob = if tgt.is_file() {
            let dest = dir.join(format!("{i}.blob"));
            std::fs::copy(&tgt, &dest).ok().map(|_| dest)
        } else {
            None
        };
        files.push(StashedFile {
            target: tgt,
            blob,
            status: status_of_path(p),
        });
    }

    if files.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Ok(StashResult {
            id: 0,
            file_count: 0,
            label,
        });
    }

    let file_count = files.len() as u32;
    if let Ok(mut store) = state.undo.lock() {
        store.entries.push(UndoEntry { id, dir, files });
        // Poda os mais antigos (com seus blobs) além dos `KEEP` recentes.
        while store.entries.len() > KEEP {
            let old = store.entries.remove(0);
            let _ = std::fs::remove_dir_all(&old.dir);
        }
    }

    Ok(StashResult {
        id,
        file_count,
        label,
    })
}

/// Desfaz uma reversão: restaura o conteúdo capturado e reaplica o agendamento
/// svn de cada arquivo, voltando ao estado exato de antes da reversão.
#[tauri::command]
pub async fn undo_revert(id: u64, state: State<'_, AppState>) -> Result<CommandOutput, String> {
    let mode = {
        let (m, _) = config_snapshot(&state);
        m
    };

    // Retira o ponto da pilha (consumido de uma vez).
    let entry = {
        let mut store = state
            .undo
            .lock()
            .map_err(|_| "estado de desfazer indisponível.".to_string())?;
        let pos = store
            .entries
            .iter()
            .position(|e| e.id == id)
            .ok_or("nada para desfazer (o ponto de desfazer expirou).")?;
        store.entries.remove(pos)
    };

    let mut restored = 0u32;
    let mut to_add: Vec<String> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for f in &entry.files {
        let path = f.target.to_string_lossy().to_string();
        match f.status.as_str() {
            // Era novo (agendado para adição): a reversão tirou o agendamento mas
            // manteve o arquivo. Reescreve o conteúdo (defensivo) e re-adiciona.
            "added" => {
                if let Some(blob) = &f.blob {
                    if std::fs::copy(blob, &f.target).is_ok() {
                        restored += 1;
                    }
                }
                to_add.push(path);
            }
            // Estava agendado para exclusão: a reversão restaurou o arquivo.
            // Re-agenda a exclusão (o `--force` remove o arquivo do disco também).
            "deleted" => to_delete.push(path),
            // Estava versionado e sumido do disco (sem agendar): a reversão o
            // restaurou. Para voltar ao estado de antes, apaga do disco de novo.
            "missing" => {
                let _ = std::fs::remove_file(&f.target);
            }
            // Modificado/substituído/conflito/etc.: basta reescrever o conteúdo.
            _ => {
                if let Some(blob) = &f.blob {
                    match std::fs::copy(blob, &f.target) {
                        Ok(_) => restored += 1,
                        Err(e) => warnings.push(format!("{}: {e}", f.target.display())),
                    }
                }
            }
        }
    }

    if !to_add.is_empty() {
        let mut args: Vec<&str> = vec!["add", "--force", "--parents", "--"];
        args.extend(to_add.iter().map(|s| s.as_str()));
        if let Ok(out) = run(&args, None, mode).await {
            if !out.success {
                warnings.push(out.stderr.trim().to_string());
            } else {
                restored += to_add.len() as u32;
            }
        }
    }
    if !to_delete.is_empty() {
        let mut args: Vec<&str> = vec!["delete", "--force", "--"];
        args.extend(to_delete.iter().map(|s| s.as_str()));
        if let Ok(out) = run(&args, None, mode).await {
            if !out.success {
                warnings.push(out.stderr.trim().to_string());
            } else {
                restored += to_delete.len() as u32;
            }
        }
    }

    let _ = std::fs::remove_dir_all(&entry.dir);

    let warnings: Vec<String> = warnings.into_iter().filter(|w| !w.is_empty()).collect();
    Ok(CommandOutput {
        success: true,
        code: Some(0),
        stdout: format!("{restored} item(ns) restaurado(s)."),
        stderr: String::new(),
        hint: if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("\n"))
        },
        command: "desfazer reversão".into(),
    })
}
