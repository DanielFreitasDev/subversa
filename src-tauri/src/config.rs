//! Persistência da configuração da aplicação em `~/.config/subversa/config.json`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::svn::types::AppConfig;

fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("subversa");
    let _ = std::fs::create_dir_all(&dir);
    // Restringe ao dono: o diretório guarda o host/usuário SSH.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    dir
}

fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// Carrega a configuração do disco; cai para os padrões (neutros, sem servidor)
/// se não existir/for inválida. Faz só uma migração leve via [`reconcile`].
/// Re-grava quando muda (ou quando o arquivo não existia).
pub fn load() -> AppConfig {
    let path = config_path();
    let existed = path.exists();
    let mut cfg = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
            // arquivo corrompido: preserva o padrão, sem derrubar o app.
            AppConfig::default()
        }),
        Err(_) => AppConfig::default(),
    };
    let changed = reconcile(&mut cfg);
    if !existed || changed {
        let _ = save(&cfg);
    }
    cfg
}

/// Migração leve: deriva `repo_base` do host quando há host mas falta `repo_base`
/// (configs antigas, anteriores a esse campo). **Não** fabrica raízes/projetos — a
/// semeadura é explícita, via a tela de primeira execução ([`AppConfig::seeded_for`]).
/// Sem host configurado (primeira execução), não faz nada. Devolve `true` se mudou.
fn reconcile(cfg: &mut AppConfig) -> bool {
    if cfg.repo_base.trim().is_empty() && !cfg.host.trim().is_empty() {
        cfg.repo_base = format!("svn+ssh://{}/usr/svn/", cfg.host.trim());
        return true;
    }
    false
}

/// Sequência monotônica para nomear temporários de gravação de forma única.
static SAVE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Grava a configuração no disco (escrita atômica via arquivo temporário).
pub fn save(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path();
    // Temporário único por gravação (pid + sequência): dois saves concorrentes
    // nunca escrevem no mesmo arquivo intermediário antes do `rename` atômico.
    let seq = SAVE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.tmp.{}.{}", std::process::id(), seq));
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    // Restringe ao dono: o arquivo contém host/usuário SSH.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
