//! Execução de processos `svn` com o ambiente de autenticação correto.

use std::path::Path;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use super::conn;
use super::parser::hint_from_stderr;
use super::types::{CommandOutput, SshMode};

/// Teto de segurança para qualquer operação `svn`: generoso a ponto de nunca
/// atingir uma operação legítima (checkout grande etc.), mas evita travar a UI
/// para sempre se o SSH conectar e nunca responder.
const SVN_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Monta uma string legível do comando (para o modo verbose da UI).
pub fn display_command(args: &[&str]) -> String {
    let mut parts = vec!["svn".to_string()];
    for a in args {
        if a.contains(' ') || a.is_empty() {
            parts.push(format!("\"{a}\""));
        } else {
            parts.push(a.to_string());
        }
    }
    parts.join(" ")
}

/// Executa `svn <args>` em `cwd` (opcional) e devolve a saída estruturada.
///
/// Sempre injeta `SVN_SSH` e repassa `$SSHPASS` (herdado do ambiente). Não
/// altera o locale para preservar as mensagens em português do usuário — o
/// parsing real usa `--xml` e os códigos de erro (E155011, ...) são estáveis.
pub async fn run(args: &[&str], cwd: Option<&Path>, mode: SshMode) -> Result<CommandOutput, String> {
    let mut cmd = Command::new("svn");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.env("SVN_SSH", conn::svn_ssh_value(mode));
    // Locale preservado de propósito (mensagens em pt-BR); o parsing usa `--xml`
    // (sempre UTF-8) e os códigos de erro, ambos independentes de idioma.

    cmd.kill_on_drop(true);

    // `kill_on_drop` garante que, no timeout, o processo é morto ao descartar o future.
    let output = match timeout(SVN_TIMEOUT, cmd.output()).await {
        Ok(res) => res
            .map_err(|e| format!("não consegui executar o svn: {e}. O Subversion está instalado?"))?,
        Err(_) => {
            return Err(
                "a operação do svn excedeu o tempo limite (30 min). Verifique a rede/VPN e o acesso SSH ao servidor."
                    .into(),
            )
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();
    let hint = if success { None } else { hint_from_stderr(&stderr) };

    Ok(CommandOutput {
        success,
        code: output.status.code(),
        stdout,
        stderr,
        hint,
        command: display_command(args),
    })
}

/// Igual a [`run`], mas falha (Err) quando o `svn` retorna código != 0,
/// embutindo stderr + dica. Útil quando o chamador quer só o stdout.
pub async fn run_checked(
    args: &[&str],
    cwd: Option<&Path>,
    mode: SshMode,
) -> Result<String, String> {
    let out = run(args, cwd, mode).await?;
    if out.success {
        Ok(out.stdout)
    } else {
        let mut msg = out.stderr.trim().to_string();
        if msg.is_empty() {
            msg = format!("svn falhou (código {:?})", out.code);
        }
        if let Some(h) = out.hint {
            msg.push_str("\n\n");
            msg.push_str(&h);
        }
        Err(msg)
    }
}
