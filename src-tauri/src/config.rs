//! Persistência da configuração da aplicação em `~/.config/subversa/config.json`.

use std::path::PathBuf;

use crate::svn::types::AppConfig;

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
pub fn load() -> AppConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
            // arquivo corrompido: preserva o padrão, sem derrubar o app.
            AppConfig::default()
        }),
        Err(_) => {
            let cfg = AppConfig::default();
            let _ = save(&cfg);
            cfg
        }
    }
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
