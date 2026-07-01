//! Cancelamento cooperativo das operações longas (checkout, update, switch,
//! merge, export, busca por conteúdo e cópias de backup).
//!
//! Cada operação em streaming se registra aqui sob o mesmo `id` que ela emite
//! no evento `op-progress` — é esse `id` que a UI conhece e devolve no comando
//! [`cancel_op`]. O token combina um `AtomicBool` (consultado por loops que
//! processam em blocos, ex.: busca e cópia de backups) com um `Notify` (acorda
//! o `select!` do runner mesmo quando a rede está muda e nenhuma linha chega).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tokio::sync::Notify;

/// Mensagem-sentinela devolvida (`Err`) por uma operação cancelada. O frontend
/// a reconhece pelo prefixo (`isCancelled` em `src/lib/op.ts`) e mostra um
/// toast informativo em vez de erro.
pub const CANCELLED_MSG: &str = "operação cancelada pelo usuário.";

#[derive(Default)]
struct Inner {
    cancelado: AtomicBool,
    notify: Notify,
}

/// Token compartilhado entre o registro e a operação em andamento.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<Inner>);

impl CancelToken {
    pub fn is_cancelled(&self) -> bool {
        self.0.cancelado.load(Ordering::Relaxed)
    }

    /// Sinaliza o cancelamento e acorda quem espera. O `notify_one` guarda uma
    /// permissão mesmo sem ninguém esperando ainda — não há wakeup perdido.
    pub fn cancel(&self) {
        self.0.cancelado.store(true, Ordering::Relaxed);
        self.0.notify.notify_one();
    }

    /// Conclui quando o cancelamento for sinalizado (imediato se já foi).
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.0.notify.notified().await;
    }
}

fn registry() -> &'static Mutex<HashMap<u64, CancelToken>> {
    static REGISTRY: OnceLock<Mutex<HashMap<u64, CancelToken>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Guarda RAII: registra o token sob o `id` e o remove ao sair de escopo
/// (inclusive nos `return` antecipados de erro), sem vazar entradas no registro.
pub struct CancelGuard {
    id: u64,
    token: CancelToken,
}

impl CancelGuard {
    pub fn token(&self) -> &CancelToken {
        &self.token
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if let Ok(mut m) = registry().lock() {
            m.remove(&self.id);
        }
    }
}

/// Registra uma operação cancelável sob o `id` do seu `op-progress`.
pub fn register(id: u64) -> CancelGuard {
    let token = CancelToken::default();
    if let Ok(mut m) = registry().lock() {
        m.insert(id, token.clone());
    }
    CancelGuard { id, token }
}

/// Cancela a operação `id`. Devolve `false` se ela já terminou (ou nunca
/// existiu) — corrida benigna: a UI simplesmente não faz nada.
#[tauri::command]
pub fn cancel_op(id: u64) -> bool {
    let token = registry().lock().ok().and_then(|m| m.get(&id).cloned());
    match token {
        Some(t) => {
            t.cancel();
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelamento_antes_do_await_retorna_imediatamente() {
        let t = CancelToken::default();
        t.cancel();
        t.cancelled().await; // não pode travar
        assert!(t.is_cancelled());
    }

    #[test]
    fn guard_remove_do_registro_no_drop() {
        let id = 999_001;
        {
            let _g = register(id);
            assert!(cancel_op(id), "operação registrada deve ser cancelável");
        }
        assert!(!cancel_op(id), "após o drop, o id não existe mais");
    }

    #[tokio::test]
    async fn cancel_op_sinaliza_o_token_registrado() {
        let id = 999_002;
        let g = register(id);
        assert!(!g.is_cancelled());
        cancel_op(id);
        assert!(g.is_cancelled());
        g.token().cancelled().await; // já sinalizado: retorna direto
    }
}
