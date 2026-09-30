mod db;
mod documents;
mod error;

use std::path::PathBuf;

use tauri::{ipc::Response, AppHandle, Manager};

use db::Db;
use documents::DocumentInfo;
use error::Result;

/// Runs blocking work (database, file system) off both the main thread and the
/// async runtime. Synchronous Tauri commands run on the main thread, so a slow
/// disk or a cloud-synced placeholder file would freeze the window.
async fn blocking<T, F>(app: AppHandle, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Db) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Db>()))
        .await
        .map_err(|e| error::Error::Message(e.to_string()))?
}

/// Records that a document was opened. The id is the SHA-256 the frontend
/// computed from the bytes returned by `read_document`.
#[tauri::command]
async fn record_open(app: AppHandle, path: PathBuf, id: String, size: u64) -> Result<DocumentInfo> {
    blocking(app, move |db| {
        let mut info = documents::describe(&path, id, size)?;
        db.record_open(&info)?;
        info.last_position = db.last_position(&info.id)?;
        Ok(info)
    })
    .await
}

#[tauri::command]
async fn save_position(app: AppHandle, id: String, position: String) -> Result<()> {
    blocking(app, move |db| db.save_position(&id, &position)).await
}

#[tauri::command]
async fn get_state(app: AppHandle, key: String) -> Result<Option<String>> {
    blocking(app, move |db| db.get_state(&key)).await
}

#[tauri::command]
async fn set_state(app: AppHandle, key: String, value: String) -> Result<()> {
    blocking(app, move |db| db.set_state(&key, &value)).await
}

/// Returns the raw file bytes as a binary IPC response (no JSON encoding).
#[tauri::command]
async fn read_document(path: PathBuf) -> Result<Response> {
    let bytes = tauri::async_runtime::spawn_blocking(move || documents::read(&path))
        .await
        .map_err(|e| error::Error::Message(e.to_string()))??;
    Ok(Response::new(bytes))
}

/// Recently opened documents whose files still exist.
#[tauri::command]
async fn recent_documents(app: AppHandle, limit: u32) -> Result<Vec<DocumentInfo>> {
    blocking(app, move |db| {
        // Ask for extra rows so files that have since been deleted don't shrink the list.
        let docs = db.recent(limit.saturating_mul(2))?;
        Ok(docs
            .into_iter()
            .filter(|d| std::path::Path::new(&d.path).exists())
            .take(limit as usize)
            .collect())
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first. A second launch focuses the running window
        // instead of starting another process on the same library database.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // TOURMALINE_DATA_DIR overrides the data folder. Development runs
            // set it because processes started by a packaged (MSIX) app, such
            // as the Claude desktop app, get AppData writes silently redirected
            // to a private copy, which splits the library in two.
            let dir = match std::env::var_os("TOURMALINE_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            let path = dir.join("library.sqlite3");
            eprintln!("Tourmaline library database: {}", path.display());
            app.manage(Db::open(&path)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            record_open,
            read_document,
            recent_documents,
            save_position,
            get_state,
            set_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tourmaline");
}
