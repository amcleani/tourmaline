mod annotations;
mod db;
mod documents;
mod error;
mod library;

use std::path::PathBuf;

use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager,
};

use annotations::{Annotation, AnnotationEdit, Category, NewAnnotation, PageHash, PlacementUpdate};
use db::Db;
use error::{Error, Result};
use library::{DocumentInfo, FileKey};

/// The folder holding the library database and its attachments.
struct DataDir(PathBuf);

/// Runs blocking work (database, file system) off both the main thread and the
/// async runtime. Synchronous Tauri commands run on the main thread, so a slow
/// disk or a cloud-synced placeholder file would freeze the window.
async fn blocking<T, F>(app: AppHandle, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &Db) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app, &app.state::<Db>()))
        .await
        .map_err(|e| Error::Message(e.to_string()))?
}

/// Reads a PDF, records it in the library and returns one binary response:
/// the `DocumentInfo` as JSON (length-prefixed) followed by the file bytes.
/// Hashing here, on exactly the bytes returned, keeps the id and the
/// displayed file in step.
#[tauri::command]
async fn open_document(app: AppHandle, path: PathBuf) -> Result<Response> {
    blocking(app, move |_, db| {
        let file = documents::read(&path)?;
        let info = db.record_open(
            &FileKey { sha256: &file.sha256, path: &file.path, name: &file.name, size: file.bytes.len() as u64 },
            db::now_millis(),
        )?;
        let header = serde_json::to_string(&info).map_err(|e| Error::Message(e.to_string()))?;
        Ok(Response::new(documents::pack(&header, &file.bytes)))
    })
    .await
}

#[tauri::command]
async fn save_position(app: AppHandle, work_id: String, position: String) -> Result<()> {
    blocking(app, move |_, db| db.save_position(&work_id, &position)).await
}

#[tauri::command]
async fn get_state(app: AppHandle, key: String) -> Result<Option<String>> {
    blocking(app, move |_, db| db.get_state(&key)).await
}

#[tauri::command]
async fn set_state(app: AppHandle, key: String, value: String) -> Result<()> {
    blocking(app, move |_, db| db.set_state(&key, &value)).await
}

/// Recently opened papers whose files still exist.
#[tauri::command]
async fn recent_documents(app: AppHandle, limit: u32) -> Result<Vec<DocumentInfo>> {
    blocking(app, move |_, db| {
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

#[tauri::command]
async fn list_annotations(app: AppHandle, work_id: String, file_id: String) -> Result<Vec<Annotation>> {
    blocking(app, move |_, db| db.list_annotations(&work_id, &file_id)).await
}

#[tauri::command]
async fn create_annotation(app: AppHandle, annotation: NewAnnotation) -> Result<Annotation> {
    blocking(app, move |_, db| db.create_annotation(&annotation)).await
}

#[tauri::command]
async fn update_annotation(app: AppHandle, id: String, file_id: String, edit: AnnotationEdit) -> Result<Annotation> {
    blocking(app, move |_, db| db.update_annotation(&id, &file_id, &edit)).await
}

#[tauri::command]
async fn delete_annotation(app: AppHandle, id: String) -> Result<()> {
    blocking(app, move |_, db| db.delete_annotation(&id)).await
}

#[tauri::command]
async fn restore_annotation(app: AppHandle, id: String, file_id: String) -> Result<Annotation> {
    blocking(app, move |_, db| db.restore_annotation(&id, &file_id)).await
}

#[tauri::command]
async fn save_placements(
    app: AppHandle,
    file_id: String,
    updates: Vec<PlacementUpdate>,
    page_hashes: Vec<PageHash>,
) -> Result<()> {
    blocking(app, move |_, db| db.save_placements(&file_id, &updates, &page_hashes)).await
}

#[tauri::command]
async fn list_categories(app: AppHandle) -> Result<Vec<Category>> {
    blocking(app, move |_, db| db.list_categories()).await
}

#[tauri::command]
async fn save_categories(app: AppHandle, categories: Vec<Category>) -> Result<Vec<Category>> {
    blocking(app, move |_, db| db.save_categories(&categories)).await
}

/// Only annotation ids (UUIDs) name attachment files, so a request can't
/// reach outside the attachments folder.
fn attachment_path(app: &AppHandle, id: &str) -> Result<(PathBuf, String)> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| Error::Message(format!("invalid annotation id {id:?}")))?;
    let relative = format!("attachments/{}.png", id.hyphenated());
    Ok((app.state::<DataDir>().0.join(&relative), relative))
}

/// Saves the PNG of an area annotation. The body is the raw PNG; the
/// annotation id comes in the `annotation-id` header.
#[tauri::command]
async fn save_attachment(app: AppHandle, request: Request<'_>) -> Result<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::Message("expected raw PNG bytes".into()));
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(Error::Message("attachment is not a PNG".into()));
    }
    let bytes = bytes.clone();
    let id = request
        .headers()
        .get("annotation-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Error::Message("missing annotation-id header".into()))?
        .to_owned();
    blocking(app, move |app, db| {
        if !db.annotation_exists(&id)? {
            return Err(Error::Message(format!("no annotation {id}")));
        }
        let (path, relative) = attachment_path(app, &id)?;
        std::fs::create_dir_all(path.parent().expect("attachments folder"))?;
        std::fs::write(&path, &bytes)?;
        db.set_annotation_image(&id, &relative)?;
        Ok(relative)
    })
    .await
}

#[tauri::command]
async fn read_attachment(app: AppHandle, id: String) -> Result<Response> {
    blocking(app, move |app, _| {
        let (path, _) = attachment_path(app, &id)?;
        Ok(Response::new(std::fs::read(path)?))
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
            app.manage(DataDir(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            recent_documents,
            save_position,
            get_state,
            set_state,
            list_annotations,
            create_annotation,
            update_annotation,
            delete_annotation,
            restore_annotation,
            save_placements,
            list_categories,
            save_categories,
            save_attachment,
            read_attachment
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tourmaline");
}
