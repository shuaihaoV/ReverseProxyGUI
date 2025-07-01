use axum::http::{self, Request, StatusCode, Uri};
use axum::{body::Body, extract::State, response::Response, Router};
use axum_server::tls_rustls::RustlsConfig;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::{SocketAddr, ToSocketAddrs},
    sync::Arc,
};
use thiserror::Error;
use tokio::sync::{oneshot, RwLock};
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

/// 代理错误类型
#[derive(Error, Debug)]
pub enum ProxyError {
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    // #[error("Port already in use: {0}")]
    // PortInUse(u16),
    // #[error("Proxy not found: {0}")]
    // ProxyNotFound(String),
    #[error("Failed to generate certificate: {0}")]
    CertificateError(String),
    // #[error("Server error: {0}")]
    // ServerError(String),
    // #[error("Proxy already running: {0}")]
    // ProxyAlreadyRunning(String),
    #[error("Failed to stop proxy: {0}")]
    StopError(String),
    // #[error("HTTP error: {0}")]
    // HttpError(String),
}

/// 自定义请求头结构体
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Header {
    pub key: String,
    pub value: String,
}

/// 代理配置结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub id: String,
    pub name: String,
    pub listen_address: String,
    pub listen_port: u16,
    pub listen_ip: String, // "0.0.0.0" or "127.0.0.1"
    pub remote_address: String,
    pub remote_host: String,
    pub use_https: bool,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default = "default_rewrite_host_headers")]
    pub rewrite_host_headers: bool,
    #[serde(default)]
    pub socks5_proxy: Option<String>,
    pub created_at: i64,
    pub is_running: bool,
}

fn default_rewrite_host_headers() -> bool {
    true
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "New Proxy".to_string(),
            listen_address: "http://127.0.0.1:8080".to_string(),
            listen_port: 8080,
            listen_ip: "127.0.0.1".to_string(),
            remote_address: "http://example.com".to_string(),
            remote_host: "example.com".to_string(),
            use_https: false,
            headers: Vec::new(),
            rewrite_host_headers: true,
            socks5_proxy: None,
            created_at: chrono::Utc::now().timestamp(),
            is_running: false,
        }
    }
}

/// 代理服务状态，包含配置和HTTP客户端
#[derive(Clone)]
pub struct ProxyState {
    pub config: ProxyConfig,
    pub client: reqwest::Client,
}

impl ProxyState {
    pub fn new(config: ProxyConfig) -> Self {
        // 创建HTTP客户端，禁用证书验证以支持自签名证书
        let mut client_builder = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .http1_only(); // 强制使用HTTP/1.1

        // 如果配置了SOCKS5代理，则添加
        if let Some(proxy_url) = &config.socks5_proxy {
            if !proxy_url.trim().is_empty() {
                match reqwest::Proxy::all(proxy_url) {
                    Ok(proxy) => {
                        client_builder = client_builder.proxy(proxy);
                        info!(
                            "Using SOCKS5 proxy for config {}: {}",
                            config.name, proxy_url
                        );
                    }
                    Err(e) => {
                        error!(
                            "Invalid SOCKS5 proxy URL {} for config {}: {}",
                            proxy_url, config.name, e
                        );
                    }
                }
            }
        }

        let client = client_builder.build().unwrap();

        Self { config, client }
    }
}

/// 代理请求处理函数
/// 将客户端请求转发到目标服务器，并重写必要的头部信息
async fn proxy_handler(
    State(state): State<ProxyState>,
    req: Request<Body>,
) -> Result<Response, (StatusCode, String)> {
    let (mut parts, body) = req.into_parts();

    let client = state.client.clone();
    let config = state.config.clone();

    // 记录请求信息
    info!(
        "Proxying {} {} for config {}",
        parts.method, parts.uri, config.name
    );

    // 构造目标URL
    let path_query = parts
        .uri
        .path_and_query()
        .map_or("", |v| v.as_str())
        .to_string();
    let target_uri = format!("{}{}", config.remote_address, path_query);

    let new_uri = Uri::try_from(target_uri.clone()).map_err(|e| {
        error!("Invalid target URI {}: {}", target_uri, e);
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid target URI: {}", e),
        )
    })?;

    // 从 http::Uri 创建 reqwest::Url
    let new_url = new_uri.to_string().parse::<reqwest::Url>().map_err(|e| {
        error!("Failed to parse target URL: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse target URL: {}", e),
        )
    })?;

    // 重写请求头
    // 1. 移除原始的 Host 头
    parts.headers.remove("host");

    // 2. 根据配置设置新的请求头
    if let Ok(remote_url) = url::Url::parse(&config.remote_address) {
        // 设置 Host 头
        let host_value = if !config.remote_host.is_empty() {
            config.remote_host.clone()
        } else if let Some(host) = remote_url.host_str() {
            if let Some(port) = remote_url.port() {
                format!("{}:{}", host, port)
            } else {
                host.to_string()
            }
        } else {
            String::new()
        };

        if !host_value.is_empty() {
            if let Ok(header_value) = http::HeaderValue::from_str(&host_value) {
                parts.headers.insert(http::header::HOST, header_value);
            }
        }

        // 重写 Referer 和 Origin 头
        if config.rewrite_host_headers {
            if let Some(host) = remote_url.host_str() {
                let scheme = remote_url.scheme();

                // 重写 Referer
                if let Some(referer) = parts.headers.get_mut(http::header::REFERER) {
                    if let Ok(referer_str) = referer.to_str() {
                        let new_referer = rewrite_url_header(referer_str, host, Some(scheme));
                        if let Ok(new_value) = http::HeaderValue::from_str(&new_referer) {
                            *referer = new_value;
                        }
                    }
                }

                // 重写 Origin
                if let Some(origin) = parts.headers.get_mut(http::header::ORIGIN) {
                    if let Ok(origin_str) = origin.to_str() {
                        let new_origin = rewrite_url_header(origin_str, host, Some(scheme));
                        if let Ok(new_value) = http::HeaderValue::from_str(&new_origin) {
                            *origin = new_value;
                        }
                    }
                }
            }
        }
    }

    // 3. 根据配置添加或重写其他请求头
    for header in &config.headers {
        if !header.key.is_empty() {
            // 跳过 Host 头，因为它已经被特殊处理了
            if header.key.to_lowercase() == "host" {
                continue;
            }

            match http::HeaderName::from_bytes(header.key.as_bytes()) {
                Ok(header_name) => match http::HeaderValue::from_str(&header.value) {
                    Ok(header_value) => {
                        parts.headers.insert(header_name, header_value);
                    }
                    Err(e) => {
                        warn!("Invalid header value for {}: {}", header.key, e);
                    }
                },
                Err(e) => {
                    warn!("Invalid header name {}: {}", header.key, e);
                }
            }
        }
    }

    // 将 axum 的请求体转换为 reqwest 的请求体（流式）
    let req_body = reqwest::Body::wrap_stream(body.into_data_stream());

    // 从 parts 和新的 body 构建 reqwest 请求
    let mut client_req = reqwest::Request::new(parts.method, new_url);
    *client_req.headers_mut() = parts.headers;
    *client_req.body_mut() = Some(req_body);

    // 发送请求
    let res = match client.execute(client_req).await {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to forward request: {}", e);
            let status = if e.is_timeout() {
                StatusCode::GATEWAY_TIMEOUT
            } else if e.is_connect() {
                StatusCode::BAD_GATEWAY
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            return Err((status, format!("Failed to forward request: {}", e)));
        }
    };

    // 准备响应头
    let mut response_builder = Response::builder().status(res.status());
    let headers = response_builder.headers_mut().unwrap();
    headers.extend(res.headers().clone());

    // 将 reqwest 的响应体转换为 axum 的响应体（流式）
    let res_body = Body::from_stream(res.bytes_stream());

    // 构建并返回响应
    response_builder.body(res_body).map_err(|e| {
        error!("Failed to build response: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })
}

/// 重写URL头部（如Referer和Origin）
/// 将原始URL中的域名部分替换为目标域名
fn rewrite_url_header(original_url: &str, target_host: &str, scheme: Option<&str>) -> String {
    if let Ok(url) = url::Url::parse(original_url) {
        let scheme = scheme.unwrap_or(url.scheme());
        let path = url.path();
        let query = url.query().map(|q| format!("?{}", q)).unwrap_or_default();
        format!("{}://{}{}{}", scheme, target_host, path, query)
    } else {
        // 如果无法解析URL，返回一个基本的URL
        let scheme = scheme.unwrap_or("http");
        format!("{}://{}", scheme, target_host)
    }
}

/// 生成自签名证书
pub fn generate_self_signed_cert() -> Result<(Vec<u8>, Vec<u8>), ProxyError> {
    use rcgen::{CertificateParams, DistinguishedName, DnType, SanType};

    let mut params = CertificateParams::default();

    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, "localhost");
    distinguished_name.push(DnType::OrganizationName, "Reverse Proxy GUI");
    distinguished_name.push(DnType::CountryName, "US");

    params.distinguished_name = distinguished_name;

    params.subject_alt_names =
        vec![
            SanType::DnsName(
                "localhost".try_into().map_err(|e| {
                    ProxyError::CertificateError(format!("Invalid DNS name: {:?}", e))
                })?,
            ),
            SanType::IpAddress("127.0.0.1".parse().map_err(|e| {
                ProxyError::CertificateError(format!("Invalid IP address: {:?}", e))
            })?),
            SanType::IpAddress("::1".parse().map_err(|e| {
                ProxyError::CertificateError(format!("Invalid IPv6 address: {:?}", e))
            })?),
        ];

    let key_pair = rcgen::KeyPair::generate()
        .map_err(|e| ProxyError::CertificateError(format!("Failed to generate key pair: {}", e)))?;

    let cert = params.self_signed(&key_pair).map_err(|e| {
        ProxyError::CertificateError(format!("Failed to generate certificate: {}", e))
    })?;

    let cert_pem = cert.pem().as_bytes().to_vec();
    let key_pem = key_pair.serialize_pem().as_bytes().to_vec();

    Ok((cert_pem, key_pem))
}

/// 代理服务器实例，包含服务器任务句柄和停止信号
pub struct ProxyInstance {
    pub config: ProxyConfig,
    pub shutdown_tx: oneshot::Sender<()>,
    pub server_handle: tokio::task::JoinHandle<()>,
}

/// 代理管理器类型
pub type ProxyManager = Arc<RwLock<HashMap<String, ProxyInstance>>>;

/// 创建并启动基于Axum的代理服务器
pub async fn create_proxy_server(
    config: ProxyConfig,
) -> Result<(oneshot::Sender<()>, tokio::task::JoinHandle<()>), ProxyError> {
    // 创建代理状态
    let proxy_state = ProxyState::new(config.clone());

    // 创建Axum应用
    let app = Router::new()
        .fallback(proxy_handler)
        .with_state(proxy_state)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(CorsLayer::permissive()),
        );

    // 创建停止信号通道
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // 监听地址
    let listen_addr = format!("{}:{}", config.listen_ip, config.listen_port);
    let addr: SocketAddr = listen_addr
        .parse()
        .map_err(|e| ProxyError::InvalidAddress(format!("Invalid listen address: {}", e)))?;

    info!(
        "Starting proxy server on {} -> {}",
        listen_addr, config.remote_address
    );

    // 克隆配置用于任务
    let config_clone = config.clone();

    // 启动服务器
    let server_handle = if config.use_https {
        // HTTPS服务器
        tokio::spawn(async move {
            // 生成自签名证书
            let (cert_pem, key_pem) = match generate_self_signed_cert() {
                Ok(certs) => certs,
                Err(e) => {
                    error!("Failed to generate certificate: {}", e);
                    return;
                }
            };

            // 创建临时证书文件
            let temp_dir = std::env::temp_dir();
            let cert_path = temp_dir.join(format!("{}_cert.pem", config_clone.id));
            let key_path = temp_dir.join(format!("{}_key.pem", config_clone.id));

            if let Err(e) = std::fs::write(&cert_path, cert_pem) {
                error!("Failed to write cert file: {}", e);
                return;
            }

            if let Err(e) = std::fs::write(&key_path, key_pem) {
                error!("Failed to write key file: {}", e);
                return;
            }

            // 创建TLS配置
            let tls_config = match RustlsConfig::from_pem_file(&cert_path, &key_path).await {
                Ok(config) => config,
                Err(e) => {
                    error!("Failed to create TLS config: {}", e);
                    // 清理临时文件
                    let _ = std::fs::remove_file(cert_path);
                    let _ = std::fs::remove_file(key_path);
                    return;
                }
            };

            // 启动HTTPS服务器
            tokio::select! {
                result = axum_server::bind_rustls(addr, tls_config)
                    .serve(app.into_make_service()) => {
                    if let Err(e) = result {
                        error!("HTTPS server error: {}", e);
                    }
                }
                _ = shutdown_rx => {
                    info!("Received shutdown signal for HTTPS proxy {}", config_clone.id);
                }
            }

            // 清理临时证书文件
            let temp_dir = std::env::temp_dir();
            let cert_path = temp_dir.join(format!("{}_cert.pem", config_clone.id));
            let key_path = temp_dir.join(format!("{}_key.pem", config_clone.id));
            let _ = std::fs::remove_file(cert_path);
            let _ = std::fs::remove_file(key_path);

            info!("HTTPS proxy server {} stopped", config_clone.id);
        })
    } else {
        // HTTP服务器
        tokio::spawn(async move {
            tokio::select! {
                result = axum_server::bind(addr)
                    .serve(app.into_make_service()) => {
                    if let Err(e) = result {
                        error!("HTTP server error: {}", e);
                    }
                }
                _ = shutdown_rx => {
                    info!("Received shutdown signal for HTTP proxy {}", config_clone.id);
                }
            }

            info!("HTTP proxy server {} stopped", config_clone.id);
        })
    };

    Ok((shutdown_tx, server_handle))
}

/// 停止代理服务器
pub async fn stop_proxy_server(instance: ProxyInstance) -> Result<(), ProxyError> {
    let ProxyInstance {
        config,
        shutdown_tx,
        server_handle,
    } = instance;

    info!("Stopping proxy server: {}", config.id);

    // 发送停止信号
    let _ = shutdown_tx.send(());

    // 等待服务器任务结束（最多等待5秒）
    match tokio::time::timeout(std::time::Duration::from_secs(5), server_handle).await {
        Ok(Ok(())) => {
            info!("Proxy server {} stopped gracefully", config.id);
            Ok(())
        }
        Ok(Err(e)) => {
            error!("Proxy server task error: {}", e);
            Err(ProxyError::StopError(format!("Task error: {}", e)))
        }
        Err(_) => {
            warn!(
                "Timeout waiting for proxy server {} to stop, forcing shutdown",
                config.id
            );
            // 超时后强制停止
            Ok(())
        }
    }
}

/// 检查端口是否被占用
pub fn check_port_available(ip: &str, port: u16) -> bool {
    match format!("{}:{}", ip, port).to_socket_addrs() {
        Ok(mut addrs) => {
            if let Some(addr) = addrs.next() {
                std::net::TcpListener::bind(addr).is_ok()
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// 启动代理服务 (Helper function)
pub async fn start_proxy_helper(manager: ProxyManager, config: ProxyConfig) -> Result<(), String> {
    let listen_addr = format!("{}:{}", config.listen_ip, config.listen_port);
    info!(
        "Starting proxy server on {} -> {}",
        listen_addr, config.remote_address
    );

    // 检查端口是否被占用
    if !check_port_available(&config.listen_ip, config.listen_port) {
        return Err(format!("Port {} is already in use", config.listen_port));
    }

    // 更新代理配置中的监听地址
    let mut updated_config = config.clone();
    updated_config.listen_address = listen_addr.clone();
    updated_config.is_running = true;

    // 启动代理服务器
    let (shutdown_tx, server_handle) = match create_proxy_server(updated_config.clone()).await {
        Ok(result) => result,
        Err(e) => return Err(format!("Failed to create proxy server: {}", e)),
    };

    // 将代理实例存储到管理器中
    let mut manager_guard = manager.write().await;
    manager_guard.insert(
        updated_config.id.clone(),
        ProxyInstance {
            config: updated_config.clone(),
            shutdown_tx,
            server_handle,
        },
    );

    info!("Proxy server {} started", updated_config.id);

    Ok(())
}
