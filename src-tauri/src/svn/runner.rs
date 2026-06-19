//! Execução de processos `svn` com o ambiente de autenticação correto.

use std::path::Path;

use tokio::process::Command;

use super::conn;
use super::parser::hint_from_stderr;
use super::types::{CommandOutput, SshMode};

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
    // Garante saída UTF-8 estável do XML.
    cmd.env("LC_ALL", std::env::var("LC_ALL").unwrap_or_default());

    cmd.kill_on_drop(true);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("não consegui executar o svn: {e}. O Subversion está instalado?"))?;

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
