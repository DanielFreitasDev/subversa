//! Execução de processos `svn` com o ambiente de autenticação correto.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::timeout;

use super::conn;
use super::parser::hint_from_stderr;
use super::types::{CommandOutput, SshMode};

/// Teto de segurança para qualquer operação `svn`: generoso a ponto de nunca
/// atingir uma operação legítima (checkout grande etc.), mas evita travar a UI
/// para sempre se o SSH conectar e nunca responder.
const SVN_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Limite padrão para operações que podem retornar texto grande, mas ainda
/// devem caber confortavelmente na memória da UI.
pub const LIMIT_DEFAULT: OutputLimit = OutputLimit {
    bytes: 20 * 1024 * 1024,
    label: "20 MiB",
};

/// Limite para prévia de arquivo (`svn cat`).
pub const LIMIT_CAT_FILE: OutputLimit = OutputLimit {
    bytes: 5 * 1024 * 1024,
    label: "5 MiB",
};

/// Limite para autoria por linha (`svn blame` + conteúdo).
pub const LIMIT_BLAME: OutputLimit = OutputLimit {
    bytes: 10 * 1024 * 1024,
    label: "10 MiB",
};

#[derive(Debug, Clone, Copy)]
pub struct OutputLimit {
    bytes: usize,
    label: &'static str,
}

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

fn output_limit_error(limit: OutputLimit, stream: &str) -> String {
    format!(
        "a saída do svn ({stream}) excedeu o limite de {}. Reduza o alvo/intervalo ou use uma ferramenta externa para esta operação.",
        limit.label
    )
}

async fn read_limited<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: OutputLimit,
    stream: &'static str,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let n = reader
            .read(&mut chunk)
            .await
            .map_err(|e| format!("falha ao ler {stream} do svn: {e}"))?;
        if n == 0 {
            return Ok(out);
        }
        if out.len().saturating_add(n) > limit.bytes {
            return Err(output_limit_error(limit, stream));
        }
        out.extend_from_slice(&chunk[..n]);
    }
}

async fn join_reader(
    res: Result<Result<Vec<u8>, String>, tokio::task::JoinError>,
    stream: &str,
) -> Result<Vec<u8>, String> {
    res.map_err(|e| format!("falha ao aguardar leitura de {stream} do svn: {e}"))?
}

/// Executa `svn <args>` em `cwd` (opcional) e devolve a saída estruturada.
///
/// Sempre injeta `SVN_SSH` e repassa `$SSHPASS` (herdado do ambiente). Não
/// altera o locale para preservar as mensagens em português do usuário — o
/// parsing real usa `--xml` e os códigos de erro (E155011, ...) são estáveis.
pub async fn run(
    args: &[&str],
    cwd: Option<&Path>,
    mode: SshMode,
) -> Result<CommandOutput, String> {
    run_limited(args, cwd, mode, LIMIT_DEFAULT).await
}

pub async fn run_limited(
    args: &[&str],
    cwd: Option<&Path>,
    mode: SshMode,
    limit: OutputLimit,
) -> Result<CommandOutput, String> {
    let mut cmd = Command::new("svn");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.env("SVN_SSH", conn::svn_ssh_value(mode));
    // Locale preservado de propósito (mensagens em pt-BR); o parsing usa `--xml`
    // (sempre UTF-8) e os códigos de erro, ambos independentes de idioma.

    cmd.kill_on_drop(true);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("não consegui executar o svn: {e}. O Subversion está instalado?"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "não consegui capturar stdout do svn".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "não consegui capturar stderr do svn".to_string())?;

    let read_streams = async {
        let mut stdout_task = tokio::spawn(read_limited(stdout, limit, "stdout"));
        let mut stderr_task = tokio::spawn(read_limited(stderr, limit, "stderr"));
        let mut stdout_data: Option<Vec<u8>> = None;
        let mut stderr_data: Option<Vec<u8>> = None;

        loop {
            if stdout_data.is_some() && stderr_data.is_some() {
                return Ok::<(Vec<u8>, Vec<u8>), String>((
                    stdout_data.unwrap_or_default(),
                    stderr_data.unwrap_or_default(),
                ));
            }

            tokio::select! {
                res = &mut stdout_task, if stdout_data.is_none() => {
                    stdout_data = Some(join_reader(res, "stdout").await?);
                }
                res = &mut stderr_task, if stderr_data.is_none() => {
                    stderr_data = Some(join_reader(res, "stderr").await?);
                }
            }
        }
    };

    // `kill_on_drop` cobre o descarte do processo; `kill().await` acelera a
    // liberação quando uma leitura passa do limite ou expira.
    let (stdout, stderr) = match timeout(SVN_TIMEOUT, read_streams).await {
        Ok(Ok(streams)) => streams,
        Ok(Err(e)) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(e);
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(
                "a operação do svn excedeu o tempo limite (30 min). Verifique a rede/VPN e o acesso SSH ao servidor."
                    .into(),
            );
        }
    };

    let status = child
        .wait()
        .await
        .map_err(|e| format!("falha ao aguardar o svn: {e}"))?;

    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();
    let success = status.success();
    let hint = if success {
        None
    } else {
        hint_from_stderr(&stderr)
    };

    Ok(CommandOutput {
        success,
        code: status.code(),
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
    run_checked_limited(args, cwd, mode, LIMIT_DEFAULT).await
}

pub async fn run_checked_limited(
    args: &[&str],
    cwd: Option<&Path>,
    mode: SshMode,
    limit: OutputLimit,
) -> Result<String, String> {
    let out = run_limited(args, cwd, mode, limit).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_limited_rejects_stream_over_limit() {
        let data = std::io::Cursor::new(vec![b'x'; 11]);
        let limit = OutputLimit {
            bytes: 10,
            label: "10 bytes",
        };
        let err = read_limited(data, limit, "stdout").await.unwrap_err();
        assert!(err.contains("excedeu o limite de 10 bytes"));
    }
}
