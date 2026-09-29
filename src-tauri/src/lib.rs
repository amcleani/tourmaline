mod db;
mod documents;
mod error;

use std::path::PathBuf;

use tauri::{ipc::Response, Manager, State};

use db::Db;
use documents::DocumentInfo;
use error::Result;

/// Records that a document was opened. The id is the SHA-256 the frontend
/// computed from the bytes returned by `read_document`.
#[tauri::command]
fn record_open(path: PathBuf, id: String, size: u64, db: State<'_, Db>) -> Result<DocumentInfo> {
    let info = documents::describe(&path, id, size)?;
    db.record_open(&info)?;
    Ok(info)
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
fn recent_documents(limit: u32, db: State<'_, Db>) -> Result<Vec<DocumentInfo>> {
    // Ask for extra rows so files that have since been deleted don't shrink the list.
    let docs = db.recent(limit.saturating_mul(2))?;
    Ok(docs
        .into_iter()
        .filter(|d| std::path::Path::new(&d.path).exists())
        .take(limit as usize)
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Db::open(&dir.join("library.sqlite3"))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            record_open,
            read_document,
            recent_documents
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tourmaline");
}
