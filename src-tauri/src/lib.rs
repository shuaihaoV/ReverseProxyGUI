use log::{error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

mod proxy_manager;
use proxy_manager::*;

pub struct AppState {
    pub proxy_manager: ProxyManager,
}

// 定义统一的错误响应格式
#[derive(serde::Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

impl From<String> for ErrorResponse {
    fn from(error: String) -> Self {
        // 尝试从错误消息中提取错误代码
        let code = if error.contains("Port") && error.contains("in use") {
            "PORT_IN_USE"
        } else if error.contains("not found") {
            "NOT_FOUND"
        } else if error.contains("Failed to deserialize") {
            "DESERIALIZATION_ERROR"
        } else {
            "UNKNOWN_ERROR"
        };

        ErrorResponse {
            error,
            code: code.to_string(),
        }
    }
}

#[tauri::command]
async fn get_all_configs(app: tauri::AppHandle) -> Result<Vec<ProxyConfig>, String> {
    let store = app.store("store.json").map_err(|e| {
        error!("Failed to open store: {e}");
        format!("Failed to open store: {e}")
    })?;

    match store.get("proxy_configs") {
        Some(value) => {
            // 验证并反序列化配置
            match serde_json::from_value::<Vec<ProxyConfig>>(value.clone()) {
                Ok(configs) => {
                    info!("Successfully loaded {} configs", configs.len());
                    Ok(configs)
                }
                Err(e) => {
                    error!("Failed to deserialize configs: {e}");
                    // 如果配置损坏，返回空列表而不是错误
                    warn!("Returning empty config list due to deserialization error");
                    Ok(Vec::new())
                }
            }
        }
        None => {
            info!("No configs found, returning empty list");
            Ok(Vec::new())
        }
    }
}

#[tauri::command]
async fn save_config(app: tauri::AppHandle, config: ProxyConfig) -> Result<(), String> {
    // 验证配置
    if config.name.trim().is_empty() {
        return Err("Config name cannot be empty".to_string());
    }

    if config.listen_port == 0 {
        return Err("Invalid port number".to_string());
    }

    let store = app.store("store.json").map_err(|e| {
        error!("Failed to open store: {e}");
        format!("Failed to open store: {e}")
    })?;

    let mut configs = match store.get("proxy_configs") {
        Some(value) => {
            serde_json::from_value::<Vec<ProxyConfig>>(value.clone()).unwrap_or_else(|e| {
                error!("Failed to deserialize existing configs: {e}, starting fresh");
                Vec::new()
            })
        }
        None => Vec::new(),
    };

    // 检查是否已存在，如果存在则更新，否则添加
    let config_name = config.name.clone();
    if let Some(existing) = configs.iter_mut().find(|c| c.id == config.id) {
        info!("Updating existing config: {config_name}");
        *existing = config;
    } else {
        info!("Adding new config: {config_name}");
        configs.push(config);
    }

    let value = serde_json::to_value(&configs)
        .map_err(|e| format!("Failed to serialize configs: {e}"))?;

    store.set("proxy_configs", value);
    store.save().map_err(|e| {
        error!("Failed to save store: {e}");
        format!("Failed to save store: {e}")
    })?;

    info!("Config saved successfully: {config_name}");
    Ok(())
}

#[tauri::command]
async fn delete_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config_id: String,
) -> Result<(), String> {
    info!("Deleting config: {config_id}");

    // 先停止代理（如果正在运行）
    {
        let proxy_manager = state.proxy_manager.read().await;
        if proxy_manager.contains_key(&config_id) {
            drop(proxy_manager);
            info!("Config is running, stopping it first");
            stop_proxy(app.clone(), state.clone(), config_id.clone()).await?;
        }
    }

    // 从存储中删除配置
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let mut configs = match store.get("proxy_configs") {
        Some(value) => serde_json::from_value::<Vec<ProxyConfig>>(value.clone())
            .map_err(|e| format!("Failed to deserialize configs: {e}"))?,
        None => return Err("No configs found".to_string()),
    };

    let initial_count = configs.len();
    configs.retain(|c| c.id != config_id);

    if configs.len() == initial_count {
        return Err(format!("Config not found: {config_id}"));
    }

    let value = serde_json::to_value(&configs)
        .map_err(|e| format!("Failed to serialize configs: {e}"))?;

    store.set("proxy_configs", value);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;

    info!("Config deleted successfully: {config_id}");
    Ok(())
}

#[tauri::command]
async fn start_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config_id: String,
) -> Result<(), String> {
    info!("Starting proxy: {config_id}");

    // 检查代理是否已经在运行
    {
        let proxy_manager = state.proxy_manager.read().await;
        if proxy_manager.contains_key(&config_id) {
            warn!("Proxy already running: {config_id}");
            return Err(format!("Proxy already running: {config_id}"));
        }
    }

    // 获取配置
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let configs = match store.get("proxy_configs") {
        Some(value) => serde_json::from_value::<Vec<ProxyConfig>>(value.clone())
            .map_err(|e| format!("Failed to deserialize configs: {e}"))?,
        None => return Err("No configs found".to_string()),
    };

    let config = configs
        .iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| format!("Config not found: {config_id}"))?
        .clone();

    // 调用辅助函数来启动代理
    start_proxy_helper(state.proxy_manager.clone(), config.clone()).await?;

    // 更新配置状态为运行中
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let mut configs = match store.get("proxy_configs") {
        Some(value) => serde_json::from_value::<Vec<ProxyConfig>>(value.clone())
            .map_err(|e| format!("Failed to deserialize configs: {e}"))?,
        None => return Err("No configs found".to_string()),
    };

    if let Some(config) = configs.iter_mut().find(|c| c.id == config_id) {
        config.is_running = true;
        info!("Updated config status to running: {}", config.name);
    }

    let value = serde_json::to_value(&configs)
        .map_err(|e| format!("Failed to serialize configs: {e}"))?;

    store.set("proxy_configs", value);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn stop_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config_id: String,
) -> Result<(), String> {
    info!("Stopping proxy: {config_id}");

    // 获取并移除代理实例
    let instance = {
        let mut proxy_manager = state.proxy_manager.write().await;
        proxy_manager.remove(&config_id).ok_or_else(|| {
            warn!("Proxy not found in manager: {config_id}");
            format!("Proxy not found: {config_id}")
        })?
    };

    // 停止代理服务器
    stop_proxy_server(instance).await.map_err(|e| {
        error!("Failed to stop proxy server: {e}");
        format!("Failed to stop proxy: {e}")
    })?;

    // 更新配置状态
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;
    let mut configs = match store.get("proxy_configs") {
        Some(value) => serde_json::from_value::<Vec<ProxyConfig>>(value.clone())
            .map_err(|e| format!("Failed to deserialize configs: {e}"))?,
        None => return Err("No configs found".to_string()),
    };

    if let Some(config) = configs.iter_mut().find(|c| c.id == config_id) {
        config.is_running = false;
        info!("Updated config status to stopped: {}", config.name);
    }

    let value = serde_json::to_value(&configs)
        .map_err(|e| format!("Failed to serialize configs: {e}"))?;

    store.set("proxy_configs", value);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn check_port(ip: String, port: u16) -> Result<bool, String> {
    if port == 0 {
        return Ok(false);
    }

    // 验证 IP 地址
    if ip != "127.0.0.1" && ip != "0.0.0.0" {
        return Ok(false);
    }

    Ok(check_port_available(&ip, port))
}

#[tauri::command]
async fn create_default_config() -> Result<ProxyConfig, String> {
    Ok(ProxyConfig::default())
}

// 优雅关闭所有代理
async fn shutdown_all_proxies(proxy_manager: ProxyManager) {
    info!("Shutting down all proxies...");
    let mut manager = proxy_manager.write().await;
    let proxy_count = manager.len();

    if proxy_count > 0 {
        info!("Stopping {proxy_count} running proxies");
        for (id, instance) in manager.drain() {
            info!("Stopping proxy {id} on app exit");
            if let Err(e) = stop_proxy_server(instance).await {
                error!("Failed to stop proxy {id}: {e}");
            }
        }
        info!("All proxies stopped");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .format_timestamp_millis()
        .init();

    info!("Starting Reverse Proxy GUI application");

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // 安装加密提供者
            let _ = rustls::crypto::ring::default_provider().install_default();

            // 初始化应用状态
            let state = AppState {
                proxy_manager: Arc::new(RwLock::new(HashMap::new())),
            };
            app.manage(state);

            // 获取 store
            let store = app.store("store.json").map_err(|e| {
                error!("Failed to open store during setup: {e}");
                format!("Failed to open store: {e}")
            })?;

            // 启动时重置所有代理的运行状态
            if let Some(value) = store.get("proxy_configs") {
                match serde_json::from_value::<Vec<ProxyConfig>>(value.clone()) {
                    Ok(mut configs) => {
                        info!("Resetting running status for {} configs", configs.len());
                        for config in &mut configs {
                            if config.is_running {
                                info!("Resetting running status for: {}", config.name);
                                config.is_running = false;
                            }
                        }
                        let updated_value = serde_json::to_value(&configs)
                            .map_err(|e| format!("Failed to serialize configs: {e}"))?;
                        store.set("proxy_configs", updated_value);
                        store
                            .save()
                            .map_err(|e| format!("Failed to save store: {e}"))?;
                    }
                    Err(e) => {
                        error!("Failed to deserialize configs during setup: {e}");
                        // 如果反序列化失败，则创建一个空的配置列表
                        store.set(
                            "proxy_configs",
                            serde_json::to_value(Vec::<ProxyConfig>::new()).unwrap(),
                        );
                        store
                            .save()
                            .map_err(|e| format!("Failed to save store: {e}"))?;
                    }
                }
            } else {
                info!("No existing configs found, initializing empty list");
                // 如果不存在配置，则创建一个空的配置列表
                store.set(
                    "proxy_configs",
                    serde_json::to_value(Vec::<ProxyConfig>::new()).unwrap(),
                );
                store
                    .save()
                    .map_err(|e| format!("Failed to save store: {e}"))?;
            }

            info!("Application setup completed successfully");
            Ok(())
        })
        .on_window_event(|window, event| {
            // 当窗口关闭时，停止所有代理
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                info!("Window close requested, shutting down proxies");
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let proxy_manager = state.proxy_manager.clone();
                    tauri::async_runtime::block_on(shutdown_all_proxies(proxy_manager));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_all_configs,
            save_config,
            delete_config,
            start_proxy,
            stop_proxy,
            check_port,
            create_default_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    info!("Application shutting down");
}
