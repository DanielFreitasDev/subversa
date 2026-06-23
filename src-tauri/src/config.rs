//! Persistência da configuração da aplicação em `~/.config/subversa/config.json`.

use std::path::PathBuf;

use crate::svn::types::{AppConfig, OFFICIAL_ROOTS};

fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("subversa");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// Carrega a configuração do disco; cai para os padrões se não existir/for inválida.
///
/// Faz um *merge não-destrutivo*: garante `repo_base` e acrescenta as raízes
/// oficiais ausentes, preservando a ordem e as raízes do usuário. Re-grava
/// quando muda (ou quando o arquivo não existia).
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

/// Garante `repo_base` (derivando do host se vazio) e semeia as raízes oficiais
/// que faltarem. Devolve `true` se alterou a config. Compara `%20`↔espaço para
/// não duplicar URLs com espaço. V1 não guarda lista de descartados: uma raiz
/// oficial removida volta no próximo boot (decisão documentada no plano).
fn reconcile(cfg: &mut AppConfig) -> bool {
    let mut changed = false;
    if cfg.repo_base.trim().is_empty() {
        cfg.repo_base = format!("svn+ssh://{}/usr/svn/", cfg.host);
        changed = true;
    }
    let base = cfg.repo_base.clone();
    let norm = |s: &str| s.replace("%20", " ");
    for name in OFFICIAL_ROOTS {
        let url = format!("{base}{name}");
        let present = cfg.repo_roots.iter().any(|r| norm(r) == norm(&url));
        if !present {
            cfg.repo_roots.push(url);
            changed = true;
        }
    }
    changed
}

/// Grava a configuração no disco (escrita atômica via arquivo temporário).
pub fn save(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let tmp = path.with_extension("json.tmp");
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
