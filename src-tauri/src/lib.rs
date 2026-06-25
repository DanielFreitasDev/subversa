//! Subversa — backend Tauri.
//!
//! Um cliente SVN desktop moderno: o frontend (React) conversa com o
//! Subversion através dos comandos definidos em [`svn::commands`].

mod config;
mod svn;

use std::sync::Mutex;

use tauri::Manager;

use svn::types::AppConfig;

/// Estado global compartilhado entre os comandos.
pub struct AppState {
    pub config: Mutex<AppConfig>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    let config = config::load();
    let host = config.host.clone();
    let host_exit = host.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(config),
        })
        .setup(|app| {
            // Coletor de auditoria dos comandos svn (arquivo + evento p/ a UI).
            svn::audit::init(app.handle().clone());

            // Reaplica o ícone embutido na janela após sua criação. Garante o
            // logo no título e na barra de tarefas do Linux (_NET_WM_ICON),
            // inclusive em modo dev, sem depender do empacotamento.
            if let (Some(icon), Some(win)) = (
                app.default_window_icon().cloned(),
                app.get_webview_window("main"),
            ) {
                let _ = win.set_icon(icon);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // leitura / detecção
            svn::commands::detect_working_copies,
            svn::commands::get_info,
            svn::commands::get_status,
            svn::commands::get_diff,
            svn::commands::diff_revision,
            svn::commands::get_log,
            svn::commands::incoming,
            svn::commands::list_dir,
            svn::commands::cat_file,
            svn::commands::blame,
            svn::commands::get_url_info,
            svn::commands::diff_urls,
            // escrita / servidor
            svn::commands::checkout,
            svn::commands::update,
            svn::commands::commit,
            svn::commands::svn_add,
            svn::commands::revert,
            svn::commands::remove,
            svn::commands::create_branch,
            svn::commands::switch_wc,
            svn::commands::merge,
            svn::commands::reverse_merge,
            svn::commands::set_revprop_message,
            svn::commands::resolve,
            svn::commands::conflict_details,
            svn::commands::resolve_with_content,
            svn::commands::cleanup,
            svn::commands::delete_remote,
            svn::commands::export_path,
            svn::commands::import_path,
            svn::commands::make_dir,
            svn::commands::move_remote,
            // config + utilidades
            svn::commands::load_config,
            svn::commands::save_config,
            svn::commands::preset_config,
            svn::commands::svn_version,
            svn::commands::check_prerequisites,
            svn::commands::test_connection,
            svn::commands::reveal_in_file_manager,
            svn::commands::open_external_diff,
            svn::commands::suggested_base_dir,
            // registro / auditoria
            svn::commands::get_command_log,
            svn::commands::clear_command_log,
            svn::commands::command_log_path,
            // backups (pontos de restauração)
            svn::backup::create_backup,
            svn::backup::list_backups,
            svn::backup::restore_backup,
            svn::backup::delete_backup,
            svn::backup::backups_dir,
        ])
        .on_window_event(move |_window, event| {
            // Ao fechar a janela, encerra a conexão SSH mestre (best-effort).
            if let tauri::WindowEvent::Destroyed = event {
                svn::conn::close_master(&host);
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar a aplicação Tauri")
        // Cobre também as saídas que não passam pelo `Destroyed` da janela.
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                svn::conn::close_master(&host_exit);
            }
        });
}

/// Instala um hook de panic que registra o erro em `~/.cache/subversa/crash.log`
/// antes de o processo abortar (a release usa `panic = "abort"`, sem unwind).
/// Garante que um panic em produção deixe rastro em vez de só sumir com a janela.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(base) = dirs::cache_dir() {
            let dir = base.join("subversa");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join("crash.log");
            // Evita crescer sem limite: passando de ~256 KB, recomeça o arquivo.
            const MAX_CRASH_LOG: u64 = 256 * 1024;
            let truncate = std::fs::metadata(&path)
                .map(|m| m.len() > MAX_CRASH_LOG)
                .unwrap_or(false);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(!truncate)
                .truncate(truncate)
                .open(&path)
            {
                use std::io::Write;
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = writeln!(f, "[{ts}] {info}");
            }
        }
        previous(info);
    }));
}
