//! Registro (auditoria) dos comandos `svn` executados.
//!
//! Um único coletor global por onde o [`runner`](super::runner) reporta cada
//! comando assim que ele termina. O coletor:
//!   * mantém um anel das últimas entradas em memória (a aba "Registro" lê);
//!   * faz append num arquivo persistente (`~/.local/share/subversa/svn.log`),
//!     com rotação simples para não crescer sem limite;
//!   * emite o evento Tauri `command-log` para a UI atualizar em tempo real.
//!
//! A senha nunca aparece aqui: vem de `$SSHPASS` no ambiente (ver
//! [`conn`](super::conn)), nunca na linha de comando registrada.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use super::types::CommandLogEntry;

/// Nome do evento Tauri emitido a cada comando registrado.
pub const EVENT: &str = "command-log";

/// Entradas mantidas em memória (sessão atual) para a UI.
const RING_CAP: usize = 1000;

/// Tamanho máximo do arquivo antes de rotacionar para `svn.log.1` (~2× no total).
const MAX_LOG_BYTES: u64 = 1024 * 1024;

struct Sink {
    file: PathBuf,
    ring: Mutex<VecDeque<CommandLogEntry>>,
    /// Serializa rotação + append para não interleaving entre comandos concorrentes.
    write_lock: Mutex<()>,
    seq: AtomicU64,
    app: AppHandle,
}

static SINK: OnceLock<Sink> = OnceLock::new();

/// Inicializa o coletor (uma vez, no `setup()` do Tauri).
pub fn init(app: AppHandle) {
    let _ = SINK.set(Sink {
        file: log_path(),
        ring: Mutex::new(VecDeque::with_capacity(RING_CAP)),
        write_lock: Mutex::new(()),
        seq: AtomicU64::new(0),
        app,
    });
}

/// Diretório de dados (não cache) para a trilha sobreviver a limpezas de cache.
/// Restringe ao dono: URLs registradas podem conter host/usuário.
fn log_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("subversa");
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    dir
}

fn log_path() -> PathBuf {
    log_dir().join("svn.log")
}

/// Caminho do arquivo de log (para a UI abrir/revelar). Vazio se não iniciado.
pub fn path() -> String {
    SINK.get()
        .map(|s| s.file.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Snapshot das entradas em memória (mais antiga → mais recente).
pub fn snapshot() -> Vec<CommandLogEntry> {
    match SINK.get() {
        Some(s) => s
            .ring
            .lock()
            .map(|r| r.iter().cloned().collect())
            .unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Limpa a visão em memória (não apaga o arquivo — preserva a auditoria).
pub fn clear() {
    if let Some(s) = SINK.get() {
        if let Ok(mut r) = s.ring.lock() {
            r.clear();
        }
    }
}

/// Registra um comando recém-executado. No-op se o coletor não foi iniciado
/// (ex.: testes do runner que não sobem o app).
pub fn record(command: &str, success: bool, code: Option<i32>, duration: Duration) {
    let Some(sink) = SINK.get() else {
        return;
    };

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let entry = CommandLogEntry {
        seq: sink.seq.fetch_add(1, Ordering::Relaxed),
        timestamp_ms,
        command: command.to_string(),
        success,
        code,
        duration_ms: duration.as_millis() as u64,
    };

    // 1) anel em memória
    if let Ok(mut ring) = sink.ring.lock() {
        if ring.len() >= RING_CAP {
            ring.pop_front();
        }
        ring.push_back(entry.clone());
    }

    // 2) arquivo persistente — serializado, best-effort (nunca derruba a operação)
    if let Ok(_guard) = sink.write_lock.lock() {
        append_to_file(&sink.file, &entry);
    }

    // 3) evento para a UI atualizar em tempo real (best-effort)
    let _ = sink.app.emit(EVENT, &entry);
}

/// Linha legível: `[2026-06-24T17:32:01.123Z] OK   cód=0 (123 ms) svn commit …`.
fn append_to_file(path: &Path, entry: &CommandLogEntry) {
    rotate_if_needed(path);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        use std::io::Write;
        let status = if entry.success { "OK  " } else { "ERRO" };
        let code = entry
            .code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "?".into());
        let _ = writeln!(
            f,
            "[{}] {status} cód={code} ({} ms) {}",
            iso8601_utc(entry.timestamp_ms),
            entry.duration_ms,
            entry.command,
        );
    }
}

/// Rotaciona `svn.log` → `svn.log.1` quando passa do limite (mantém ~2×).
fn rotate_if_needed(path: &Path) {
    let too_big = std::fs::metadata(path)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if too_big {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
}

/// Converte epoch (ms) para `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC), sem dependências.
/// Algoritmo de data civil de Howard Hinnant (`civil_from_days`).
fn iso8601_utc(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let millis = ms % 1000;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (hh, mm, ss) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };

    format!("{year:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_epoch_zero() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn iso8601_known_dates() {
        // 2000-01-01T00:00:00Z = 946684800 s (cobre a regra dos 400 anos)
        assert_eq!(iso8601_utc(946_684_800_000), "2000-01-01T00:00:00.000Z");
        // 2026-01-01T00:00:00Z = 1767225600 s
        assert_eq!(iso8601_utc(1_767_225_600_000), "2026-01-01T00:00:00.000Z");
        // hora/minuto/segundo/milissegundo
        assert_eq!(iso8601_utc(1_767_225_600_000 + 63_121_123), "2026-01-01T17:32:01.123Z");
    }
}
