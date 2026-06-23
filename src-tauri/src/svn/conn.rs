//! Configuração de autenticação para `svn+ssh`.
//!
//! Reproduz a estratégia do `fluxo_svn.sh`:
//!   * usa uma conexão SSH mestre (ControlMaster) para não repetir senha;
//!   * se houver `$SSHPASS` no ambiente, autentica com `sshpass -e ssh ...`;
//!   * caso contrário, usa `ssh` puro (chave/agent).
//!
//! O valor resultante é exportado na variável de ambiente `SVN_SSH`, que o
//! Subversion usa como "tunnel agent" para URLs `svn+ssh:`.

use std::path::PathBuf;

use super::types::SshMode;

/// Diretório onde guardamos o socket do ControlMaster. Mantido estável entre
/// chamadas para que a conexão seja reaproveitada.
fn control_dir() -> PathBuf {
    let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("subversa").join("ssh");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Opções comuns do ssh — host key automática, timeouts e multiplexação.
fn ssh_options() -> String {
    let cp = control_dir().join("cm-%r@%h:%p");
    format!(
        "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
         -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
         -o ControlMaster=auto -o ControlPath={} -o ControlPersist=300",
        cp.to_string_lossy()
    )
}

/// Monta o valor de `SVN_SSH` conforme o modo de autenticação.
pub fn svn_ssh_value(mode: SshMode) -> String {
    let opts = ssh_options();
    let has_pass = std::env::var("SSHPASS").map(|v| !v.is_empty()).unwrap_or(false);

    match mode {
        SshMode::Key => format!("ssh {opts}"),
        SshMode::Password => format!("sshpass -e ssh {opts}"),
        SshMode::Auto => {
            // `sshpass -e` é inofensivo quando a chave já autentica (o ssh
            // simplesmente não pede senha). Então, havendo `$SSHPASS`, usá-lo
            // cobre os dois casos.
            if has_pass && which("sshpass") {
                format!("sshpass -e ssh {opts}")
            } else {
                format!("ssh {opts}")
            }
        }
    }
}

/// Procura um executável no PATH (sem depender de crates externas).
pub fn which(bin: &str) -> bool {
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let candidate = std::path::Path::new(dir).join(bin);
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

/// Encerra a conexão mestre do ControlMaster (chamado no fim, best-effort).
pub fn close_master(host: &str) {
    // Sem host configurado (primeira execução) não há socket para encerrar.
    if host.trim().is_empty() {
        return;
    }
    let cp = control_dir().join("cm-%r@%h:%p");
    let _ = std::process::Command::new("ssh")
        .args(["-O", "exit", "-o"])
        .arg(format!("ControlPath={}", cp.to_string_lossy()))
        .arg(host)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}
