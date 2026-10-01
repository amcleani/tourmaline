mod annotations;
mod db;
mod documents;
mod error;
mod library;
mod pdf_annotations;
mod writeback;
mod vault;

use std::path::PathBuf;

use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager,
};

use annotations::{Annotation, AnnotationEdit, Category, ImportResult, NewAnnotation, PageHash, PlacementUpdate};
use db::Db;
use error::{Error, Result};
use library::{DocumentInfo, FileKey};
use vault::{Bibliography, MathSettings, VaultSettings};

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

/// Records the start of a file's text (see `Db::set_text_sample`).
#[tauri::command]
async fn set_text_sample(app: AppHandle, file_id: String, sample: String) -> Result<()> {
    blocking(app, move |_, db| db.set_text_sample(&file_id, &sample)).await
}

/// Gives a file that replaced another paper's file a work of its own.
#[tauri::command]
async fn detach_file(app: AppHandle, file_id: String, sample: String) -> Result<DocumentInfo> {
    blocking(app, move |_, db| db.detach_file(&file_id, &sample)).await
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

/// Checks that a folder the user picked is an Obsidian vault.
#[tauri::command]
async fn check_vault(app: AppHandle, path: PathBuf) -> Result<()> {
    blocking(app, move |_, _| vault::check_vault(&path)).await
}

/// How the vault renders math: MathJax plugin settings and the preamble (read only).
#[tauri::command]
async fn math_settings(app: AppHandle, vault: PathBuf) -> Result<MathSettings> {
    blocking(app, move |_, _| vault::math_settings(&vault)).await
}

/// Where the vault keeps literature notes and the bibliography (read only).
#[tauri::command]
async fn vault_settings(app: AppHandle, vault: PathBuf) -> Result<VaultSettings> {
    blocking(app, move |_, _| vault::vault_settings(&vault)).await
}

/// Whether a note exists at a path relative to the vault.
#[tauri::command]
async fn vault_file_exists(app: AppHandle, vault: PathBuf, path: String) -> Result<bool> {
    blocking(app, move |_, _| vault::vault_file_exists(&vault, &path)).await
}

/// Reads the JabRef bibliography (never written).
#[tauri::command]
async fn read_bibliography(app: AppHandle, path: PathBuf) -> Result<Bibliography> {
    blocking(app, move |_, _| vault::read_bibliography(&path)).await
}

#[tauri::command]
async fn bibliography_modified(app: AppHandle, path: PathBuf) -> Result<i64> {
    blocking(app, move |_, _| vault::bibliography_modified(&path)).await
}

/// Links a file's paper to a bibliography entry (see `Db::link_citekey`).
#[tauri::command]
async fn link_citekey(app: AppHandle, file_id: String, citekey: String) -> Result<DocumentInfo> {
    blocking(app, move |_, db| db.link_citekey(&file_id, &citekey)).await
}

/// For a tourmaline:// link: the most recently opened file of a paper (named
/// by its id, or by one of its annotations' block ids) that still exists.
#[tauri::command]
async fn locate_work(app: AppHandle, work_id: Option<String>, block_id: Option<String>) -> Result<Option<DocumentInfo>> {
    blocking(app, move |_, db| {
        let by_block = match &block_id {
            Some(block) => db.work_for_block(block)?,
            None => None,
        };
        for work in work_id.iter().chain(by_block.iter()) {
            let file = db.work_files(work)?.into_iter().find(|d| std::path::Path::new(&d.path).exists());
            if file.is_some() {
                return Ok(file);
            }
        }
        Ok(None)
    })
    .await
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

/// The `/NM` names of the annotations in a PDF, for the version `file_id`
/// (refused if the file on disk has changed since).
#[tauri::command]
async fn pdf_annotation_names(
    app: AppHandle,
    path: PathBuf,
    file_id: String,
) -> Result<Vec<pdf_annotations::AnnotationName>> {
    blocking(app, move |_, _| {
        let file = documents::read(&path)?;
        if file.sha256 != file_id {
            return Err(Error::Message(format!("{} has changed since it was opened", path.display())));
        }
        pdf_annotations::annotation_names(&file.bytes)
    })
    .await
}

/// Writes a paper's annotations into its PDF (File › Save annotations into
/// PDF). The file must still be the version `file_id`. Its bytes are first
/// backed up to `<data>/backups/pdf/<sha256>.pdf` (see `prune_backups`); the changes are appended
/// as an incremental update, written beside the file and moved over it.
/// Returns the new version, which the tab then shows, or None if the file
/// already had everything (then nothing is written or backed up).
#[tauri::command]
async fn save_annotations_to_pdf(
    app: AppHandle,
    path: PathBuf,
    file_id: String,
    work_id: String,
    annotations: Vec<writeback::WriteAnnotation>,
) -> Result<Option<DocumentInfo>> {
    blocking(app, move |app, db| {
        // One save at a time: two would race on the same file.
        static SAVING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _saving = SAVING.lock().unwrap_or_else(|e| e.into_inner());
        let file = documents::read(&path)?;
        if file.sha256 != file_id {
            return Err(Error::Message(format!(
                "{} has changed since it was opened; reopen it first",
                path.display()
            )));
        }
        let removed = db.writeback_removals(&work_id, &file_id)?;
        let written = writeback::write_annotations(&file.bytes, &annotations, &removed)?;
        if !written.changed {
            return Ok(None);
        }
        // The file as it is now, kept before it changes (see prune_backups).
        let backups = app.state::<DataDir>().0.join("backups").join("pdf");
        let backup = backups.join(format!("{file_id}.pdf"));
        let backed_up = std::fs::read(&backup).is_ok_and(|b| documents::sha256_hex(&b) == file_id);
        if !backed_up {
            write_synced(&backup, &file.bytes)?;
        }
        let max_age = std::time::Duration::from_secs(writeback::BACKUP_DAYS * 86_400);
        if let Err(e) = writeback::prune_backups(&backups, |sha| db.file_origin(sha), max_age) {
            eprintln!("Tourmaline: could not prune PDF backups: {e}");
        }
        write_synced(&path, &written.bytes).map_err(|e| {
            Error::Message(format!(
                "could not save into {} ({e}); if another program has it open, close it and try again",
                path.display()
            ))
        })?;
        let sha = documents::sha256_hex(&written.bytes);
        db.record_writeback(
            &file_id,
            &FileKey { sha256: &sha, path: &file.path, name: &file.name, size: written.bytes.len() as u64 },
            &written.refs,
            &removed,
        )
        .map(Some)
    })
    .await
}

/// Writes a file whole or not at all: into a temporary file beside it,
/// flushed to disk, then renamed over it.
fn write_synced(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| Error::Message(format!("{} has no folder", path.display())))?;
    std::fs::create_dir_all(dir)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}.tourmaline-saving", uuid::Uuid::new_v4().simple()));
    let result = (|| -> Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Keys of the annotations already imported into a paper (deleted ones too).
#[tauri::command]
async fn imported_keys(app: AppHandle, work_id: String) -> Result<Vec<String>> {
    blocking(app, move |_, db| db.imported_keys(&work_id)).await
}

/// Imports annotations found in a PDF; each only once per paper.
#[tauri::command]
async fn import_annotations(app: AppHandle, annotations: Vec<NewAnnotation>) -> Result<ImportResult> {
    blocking(app, move |_, db| db.import_annotations(&annotations)).await
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
        // tourmaline:// links from notes. A link clicked while the app runs
        // reaches it through the single-instance plugin above.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Installers register the scheme; a development build registers
            // itself for the current user so links can be tried.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("Tourmaline: could not register tourmaline:// links: {e}");
                }
            }
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
            set_text_sample,
            detach_file,
            recent_documents,
            save_position,
            get_state,
            set_state,
            list_annotations,
            create_annotation,
            import_annotations,
            imported_keys,
            save_annotations_to_pdf,
            pdf_annotation_names,
            update_annotation,
            delete_annotation,
            restore_annotation,
            save_placements,
            list_categories,
            save_categories,
            save_attachment,
            read_attachment,
            check_vault,
            math_settings,
            vault_settings,
            vault_file_exists,
            read_bibliography,
            bibliography_modified,
            link_citekey,
            locate_work
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tourmaline");
}
