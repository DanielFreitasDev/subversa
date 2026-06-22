//! Subversa — backend Tauri.
//!
//! Um cliente SVN desktop moderno: o frontend (React) conversa com o
//! Subversion através dos comandos definidos em [`svn::commands`].

mod config;
mod svn;

use std::sync::Mutex;

use svn::types::AppConfig;

/// Estado global compartilhado entre os comandos.
pub struct AppState {
    pub config: Mutex<AppConfig>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = config::load();
    let host = config.host.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(config),
        })
        .invoke_handler(tauri::generate_handler![
            // leitura / detecção
            svn::commands::detect_working_copies,
            svn::commands::get_info,
            svn::commands::get_status,
            svn::commands::get_diff,
            svn::commands::diff_revision,
            svn::commands::get_log,
            svn::commands::list_dir,
            svn::commands::cat_file,
            svn::commands::blame,
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
            svn::commands::resolve,
            svn::commands::cleanup,
            svn::commands::delete_remote,
            // config + utilidades
            svn::commands::load_config,
            svn::commands::save_config,
            svn::commands::svn_version,
            svn::commands::test_connection,
            svn::commands::reveal_in_file_manager,
            svn::commands::open_external_diff,
            svn::commands::suggested_base_dir,
        ])
        .on_window_event(move |_window, event| {
            // Ao fechar, encerra a conexão SSH mestre (best-effort).
            if let tauri::WindowEvent::Destroyed = event {
                svn::conn::close_master(&host);
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a aplicação Tauri");
}
