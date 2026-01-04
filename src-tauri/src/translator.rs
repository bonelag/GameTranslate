use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};
use std::time::{Duration, Instant};
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslatorConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,
    pub stream: bool,
    pub threads: usize,
    pub batch_size: usize,
    pub delay: f64,
    pub last_file: String,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    thread_id: usize,
    current: usize,
    total: usize,
    message: String,
    append: bool,
}

struct RateLimiter {
    last_request: Mutex<Instant>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            last_request: Mutex::new(Instant::now().checked_sub(Duration::from_secs(3600)).unwrap()),
        }
    }

    async fn wait(&self, delay_secs: f64) {
        if delay_secs <= 0.0 {
            return;
        }
        let delay = Duration::from_secs_f64(delay_secs);
        let target_time;
        {
            let mut last = self.last_request.lock().unwrap();
            let now = Instant::now();
            if now.duration_since(*last) < delay {
                target_time = *last + delay;
            } else {
                target_time = now;
            }
            *last = target_time;
        }

        tokio::time::sleep_until(tokio::time::Instant::from_std(target_time)).await;
    }
}

pub struct TranslatorState {
    pub stop_flag: Arc<Mutex<bool>>, 
    rate_limiter: Arc<RateLimiter>,
    kill_notify: Arc<Mutex<Arc<tokio::sync::Notify>>>,
}

impl TranslatorState {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(Mutex::new(false)),
            rate_limiter: Arc::new(RateLimiter::new()),
            kill_notify: Arc::new(Mutex::new(Arc::new(tokio::sync::Notify::new()))),
        }
    }
}

// === PATH HELPERS ===
fn get_app_root() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from("../")
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn get_path(filename: &str) -> PathBuf {
    let mut path = get_app_root();
    path.push(filename);
    path
}

fn log_thread_activity(thread_id: usize, start_id: &str, end_id: &str) {
    let path = get_path("thread.txt");
    let msg = format!("Thread {}: {}-{}\n", thread_id, start_id, end_id);
    // Append or create
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(msg.as_bytes());
    }
}
// ====================

#[tauri::command]
pub async fn stop_translation(state: tauri::State<'_, TranslatorState>, app: AppHandle) -> Result<(), String> {
    {
        let mut stop = state.stop_flag.lock().map_err(|e| e.to_string())?;
        *stop = true;
    }
    
    {
        let notify = state.kill_notify.lock().map_err(|e| e.to_string())?;
        notify.notify_waiters();
    }

    let _ = app.emit("progress", ProgressEvent {
        thread_id: 0,
        current: 0,
        total: 0,
        message: "⛔ KILLED.".to_string(),
        append: false,
    });

    Ok(())
}

#[tauri::command]
pub async fn save_config(config: TranslatorConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(get_path("config.json"), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_config() -> Result<Option<TranslatorConfig>, String> {
    let path = get_path("config.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: TranslatorConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(config))
}

#[tauri::command]
pub async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch models: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    
    let mut models = Vec::new();
    if let Some(data) = json.get("data") {
        if let Some(arr) = data.as_array() {
            for item in arr {
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    models.push(id.to_string());
                }
            }
        }
    } else if let Some(arr) = json.as_array() {
        for item in arr {
             if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    }
    
    models.sort();
    Ok(models)
}

fn save_temp_file(lines: &[String]) {
    let _ = std::fs::write(get_path("temp_translating.txt"), lines.join("\n"));
}

#[tauri::command]
pub async fn start_translation(
    app: AppHandle,
    state: tauri::State<'_, TranslatorState>,
    config: TranslatorConfig,
    file_path: String,
) -> Result<(), String> {
    let kill_signal = Arc::new(tokio::sync::Notify::new());
    {
        let mut stop = state.stop_flag.lock().map_err(|e| e.to_string())?;
        *stop = false;
        
        let mut notify_guard = state.kill_notify.lock().map_err(|e| e.to_string())?;
        *notify_guard = kill_signal.clone();
    }
    
    let _ = std::fs::write(get_path("thread.txt"), "");

    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let raw_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    
    let mut initial_output = Vec::new();
    let start_idx = if !raw_lines.is_empty() && raw_lines[0].starts_with("0:::") { 1 } else { 0 };

    if start_idx == 1 {
        initial_output.push(raw_lines[0].clone());
    }

    for line in raw_lines.iter().skip(start_idx) {
        if let Some((id, _)) = line.split_once(":::") {
            initial_output.push(format!("{}:::", id.trim()));
        } else {
            initial_output.push(line.clone());
        }
    }

    let mut work_items = Vec::new();
    for (i, line) in raw_lines.iter().enumerate().skip(start_idx) {
        work_items.push((i, line.clone()));
    }

    let batch_size = config.batch_size.max(1);
    let batches: Vec<Vec<(usize, String)>> = work_items.chunks(batch_size).map(|c| c.to_vec()).collect();
    
    let total_batches = batches.len();
    let finished_batches = Arc::new(AtomicUsize::new(0));
    
    let stop_flag = state.stop_flag.clone();
    let rate_limiter = state.rate_limiter.clone();
    let config = Arc::new(config);
    let output_mutex = Arc::new(Mutex::new(initial_output));
    
    let semaphore = Arc::new(tokio::sync::Semaphore::new(config.threads.max(1)));
    let mut tasks = tokio::task::JoinSet::new();

    // Initial Status
    let _ = app.emit("progress", ProgressEvent {
        thread_id: 0,
        current: 0,
        total: total_batches,
        message: format!("Started. {} Batches.", total_batches),
        append: false,
    });
    
    // Dispatch batches
    for (i, batch) in batches.into_iter().enumerate() {
        let global_thread_id = i + 1; // Thread 1, 2, 3...
        
        // Wait for worker slot. This blocks until a thread is free.
        let permit = semaphore.clone().acquire_owned().await.map_err(|e| e.to_string())?;
        
        let batch_len = batch.len();
        let start_line_content = &batch.first().map(|x| x.1.clone()).unwrap_or_default();
        let end_line_content = &batch.last().map(|x| x.1.clone()).unwrap_or_default();

        let start_id = start_line_content.split(":::").next().unwrap_or("?").trim();
        let end_id = end_line_content.split(":::").next().unwrap_or("?").trim();
        
        log_thread_activity(global_thread_id, start_id, end_id);

        let config = config.clone();
        let stop_flag = stop_flag.clone();
        let rate_limiter = rate_limiter.clone();
        let app_handle = app.clone();
        let output_mutex = output_mutex.clone();
        let kill_signal = kill_signal.clone();
        let finished_batches = finished_batches.clone();
        
        let start_id_owned = start_id.to_string();
        let end_id_owned = end_id.to_string();

        tasks.spawn(async move {
            let _permit = permit; // drop when finished
            
            if *stop_flag.lock().unwrap() { return; }
            
            let _ = app_handle.emit("progress", ProgressEvent {
                thread_id: global_thread_id,
                current: 0,
                total: batch_len,
                message: format!("Processing {}-{}", start_id_owned, end_id_owned),
                append: false,
            });

            let client = reqwest::Client::new();
            let batch_lines: Vec<String> = batch.iter().map(|(_, s)| s.clone()).collect();
            let batch_indices: Vec<usize> = batch.iter().map(|(i, _)| *i).collect();

            // Retry Loop
            loop {
                if *stop_flag.lock().unwrap() { break; }
                
                tokio::select! {
                    _ = rate_limiter.wait(config.delay) => {},
                    _ = kill_signal.notified() => { break; }
                }

                let result = tokio::select! {
                     res = call_api_translate_with_result(
                        &client, 
                        &config, 
                        &batch_lines, 
                        &app_handle, 
                        global_thread_id,
                        batch_len
                     ) => res,
                     _ = kill_signal.notified() => { break; }
                };
                
                match result {
                    Ok(translated) => {
                        {
                            let mut out = output_mutex.lock().unwrap();
                            for (idx, text) in batch_indices.iter().zip(translated.iter()) {
                                out[*idx] = text.clone();
                            }
                            save_temp_file(&out);
                        }
                         let _ = app_handle.emit("progress", ProgressEvent {
                            thread_id: global_thread_id,
                            current: batch_len,
                            total: batch_len,
                            message: "Done.".to_string(),
                            append: false,
                        });
                        
                        // Update Global Progress (Thread 0)
                        let finished = finished_batches.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = app_handle.emit("progress", ProgressEvent {
                            thread_id: 0,
                            current: finished,
                            total: total_batches,
                            message: format!("Progress: {}/{} Batches", finished, total_batches),
                            append: false,
                        });

                        break; 
                    }
                    Err(e) => {
                         let _ = app_handle.emit("progress", ProgressEvent {
                            thread_id: global_thread_id,
                            current: 0,
                            total: batch_len,
                            message: format!("Error: {}. Retrying...", e),
                            append: true,
                        });
                        tokio::time::sleep(Duration::from_millis(1000)).await;
                    }
                }
            }
        });
    }

    while let Some(_) = tasks.join_next().await {}

    if !*state.stop_flag.lock().unwrap() {
        let final_lines = output_mutex.lock().unwrap();
        let output_path = get_path("tran.txt");
        let mut file = std::fs::File::create(output_path).map_err(|e| e.to_string())?;
        for line in final_lines.iter() {
            writeln!(file, "{}", line).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("progress", ProgressEvent {
            thread_id: 0,
            current: total_batches,
            total: total_batches,
            message: "Finished.".to_string(),
            append: false,
        });
    }

    Ok(())
}

async fn call_api_translate_with_result(
    client: &reqwest::Client,
    config: &TranslatorConfig,
    lines: &[String],
    app: &AppHandle,
    thread_id: usize,
    total_in_chunk: usize,
) -> Result<Vec<String>, String> {
    let prompt = lines.join("\n") + "\n\nREMINDER: Format 'ID:::TranslatedText'.";
    
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    
    let mut payload = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": config.system_prompt},
            {"role": "user", "content": prompt},
        ],
        "stream": config.stream
    });

    if let Some(t) = config.temperature { payload["temperature"] = serde_json::json!(t); }
    if let Some(m) = config.max_tokens { payload["max_tokens"] = serde_json::json!(m); }
    if let Some(p) = config.top_p { payload["top_p"] = serde_json::json!(p); }
    if let Some(k) = config.top_k { payload["top_k"] = serde_json::json!(k); }

    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("API Status: {}", resp.status()));
    }

    let mut full_content = String::new();

    if config.stream {
        use futures_util::StreamExt;
        let mut stream = resp.bytes_stream();
        let mut buffer = Vec::new();

        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| e.to_string())?;
            buffer.extend_from_slice(&chunk);
            
            if let Some(last_newline_idx) = buffer.iter().rposition(|&b| b == b'\n') {
                let complete_chunk = buffer.drain(..=last_newline_idx).collect::<Vec<u8>>();
                let s = String::from_utf8_lossy(&complete_chunk);
                
                for line in s.lines() {
                    let line = line.trim();
                    if line.starts_with("data: ") {
                        let data = &line[6..];
                        if data == "[DONE]" { break; }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                             if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                                 full_content.push_str(content);
                                 let _ = app.emit("progress", ProgressEvent {
                                    thread_id,
                                    current: 0,
                                    total: total_in_chunk,
                                    message: content.to_string(),
                                    append: true,
                                 });
                             }
                        }
                    }
                }
            }
        }
        
        if !buffer.is_empty() {
             let s = String::from_utf8_lossy(&buffer);
             for line in s.lines() {
                 let line = line.trim();
                 if line.starts_with("data: ") {
                    let data = &line[6..];
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                            full_content.push_str(content);
                        }
                    }
                 }
             }
        }
    } else {
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
            full_content = content.to_string();
            let _ = app.emit("progress", ProgressEvent {
                thread_id,
                current: 0,
                total: total_in_chunk,
                message: format!("Received {} chars", full_content.len()),
                append: true,
            });
        }
    }

    let translated_lines: Vec<&str> = full_content.trim().split('\n').collect();
    let mut translated_map = std::collections::HashMap::new();
    
    for line in translated_lines {
        if let Some((id, text)) = line.split_once(":::") {
            translated_map.insert(id.trim().to_string(), text.trim().to_string());
        }
    }

    let mut new_results = Vec::new();
    for line in lines {
        let id_part = line.split(":::").next().unwrap_or("").trim();
        if !id_part.is_empty() {
             if let Some(trans) = translated_map.get(id_part) {
                 new_results.push(format!("{}:::{}", id_part, trans));
             } else {
                 new_results.push(line.clone());
             }
        } else {
            new_results.push(line.clone());
        }
    }

    Ok(new_results)
}
