//! On-demand, account-free LAN portal. No request/credential logging and no remote assets.
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::Incoming, server::conn::http1, service::service_fn, Method, Request, Response, StatusCode,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_native_bridge::NativeBridgeExt;
use tokio::{
    io::AsyncWriteExt,
    net::TcpListener,
    sync::{oneshot, Semaphore},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const TTL: u64 = 15 * 60;
const MAX_FILE: u64 = 100 * 1024 * 1024;
const MAX_BATCH: u64 = 500 * 1024 * 1024;
const PAGE: &str = include_str!("tv_portal/index.html");
const SCRIPT: &str = include_str!("tv_portal/app.js");
const CSS: &str = include_str!("tv_portal/style.css");
const LOCK_ERROR: &str = "接收服务暂时不可用";
type Reply = Response<Full<Bytes>>;
type RpcReply = Result<Value, String>;
#[derive(Default)]
pub struct PortalState(tokio::sync::Mutex<Option<Arc<Session>>>);
struct Session {
    data: Mutex<Data>,
    stop: CancellationToken,
    dir: PathBuf,
}
struct Data {
    port: u16,
    addresses: Vec<String>,
    network: String,
    token: String,
    expires_at: u64,
    accepting: bool,
    uploads: Vec<Upload>,
    pending: HashMap<String, oneshot::Sender<RpcReply>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Upload {
    id: String,
    batch: String,
    name: String,
    size: u64,
    received: u64,
    status: String,
    #[serde(skip)]
    cancel: CancellationToken,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalStatus {
    active: bool,
    port: u16,
    addresses: Vec<String>,
    token: String,
    expires_at: u64,
    accepting: bool,
    uploads: Vec<Upload>,
}
#[derive(Deserialize)]
struct FileSpec {
    name: String,
    size: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn addresses() -> Vec<String> {
    let mut interfaces = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| {
            if interface.is_loopback() {
                return None;
            }
            match interface.ip() {
                std::net::IpAddr::V4(ip) if ip.is_private() && !ip.is_link_local() => {
                    Some((interface.name, ip.to_string()))
                }
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    // Wi-Fi/Ethernet ahead of VPN, cellular and virtual adapters. Every candidate remains selectable.
    interfaces.sort_by_key(|(name, ip)| {
        (
            !name.starts_with("wlan") && !name.starts_with("eth") && !name.starts_with("en"),
            ip.clone(),
        )
    });
    let mut result = Vec::new();
    for (_, ip) in interfaces {
        if !result.contains(&ip) {
            result.push(ip);
        }
    }
    result
}
fn network_state<R: Runtime>(app: &AppHandle<R>) -> (Vec<String>, String) {
    if let Ok(value) = app.native_bridge().lan_network_state() {
        if let (Some(list), Some(fingerprint)) = (
            value.get("addresses").and_then(Value::as_array),
            value.get("fingerprint").and_then(Value::as_str),
        ) {
            let ips = list
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| {
                    value
                        .parse::<Ipv4Addr>()
                        .is_ok_and(|ip| ip.is_private() && !ip.is_loopback())
                })
                .map(str::to_string)
                .collect();
            return (ips, fingerprint.to_string());
        }
    }
    let ips = addresses();
    let fingerprint = ips.join("|");
    (ips, fingerprint)
}
fn valid_spec(spec: &FileSpec) -> bool {
    let name = &spec.name;
    !name.is_empty()
        && name.len() <= 240
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
        && spec.size > 0
        && spec.size <= MAX_FILE
        && name.rsplit('.').next().is_some_and(|ext| {
            ["txt", "epub", "pdf", "mobi", "azw3", "fb2", "cbz"]
                .contains(&ext.to_lowercase().as_str())
        })
}
fn rotate(data: &mut Data, ips: Vec<String>, network: String) {
    data.network = network;
    data.addresses = ips;
    data.token = secret();
    data.expires_at = now() + TTL;
    for upload in &mut data.uploads {
        if ["pending", "ready", "receiving"].contains(&upload.status.as_str()) {
            upload.cancel.cancel();
            upload.status = "cancelled".into();
        }
    }
    data.pending.clear();
}
fn snapshot(session: &Session, expose_token: bool) -> Result<PortalStatus, String> {
    let d = session.data.lock().map_err(|_| LOCK_ERROR)?;
    Ok(PortalStatus {
        active: !session.stop.is_cancelled() && d.expires_at > now(),
        port: d.port,
        addresses: d.addresses.clone(),
        token: if expose_token {
            d.token.clone()
        } else {
            String::new()
        },
        expires_at: d.expires_at,
        accepting: d.accepting,
        uploads: d.uploads.clone(),
    })
}
fn active_capability(session: &Session, data: &Data, token: &str) -> bool {
    !session.stop.is_cancelled() && now() < data.expires_at && data.token == token
}
fn response(code: StatusCode, data: impl Into<Bytes>, content_type: &str) -> Reply {
    Response::builder().status(code).header("Content-Type", content_type).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer").header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src blob:; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").body(Full::new(data.into())).unwrap()
}
fn result(value: Value) -> Reply {
    response(
        StatusCode::OK,
        value.to_string(),
        "application/json; charset=utf-8",
    )
}
fn error(code: StatusCode, message: &str) -> Reply {
    response(
        code,
        json!({"error": message}).to_string(),
        "application/json; charset=utf-8",
    )
}
fn same_host(host: &str, data: &Data) -> bool {
    data.addresses
        .iter()
        .any(|ip| host == format!("{ip}:{}", data.port))
}
fn authorized<B>(req: &Request<B>, data: &Data) -> bool {
    let supplied = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // Fixed-size random capability; compare all bytes, not the first differing byte.
    let expected = format!("Bearer {}", data.token);
    supplied.len() == expected.len()
        && supplied
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
        && now() < data.expires_at
}
async fn json_body(body: Incoming) -> Result<Value, ()> {
    let bytes = tokio::time::timeout(
        Duration::from_secs(10),
        Limited::new(body, 64 * 1024).collect(),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?
    .to_bytes();
    serde_json::from_slice(&bytes).map_err(|_| ())
}
async fn route(
    req: Request<Incoming>,
    session: Arc<Session>,
    emit: impl Fn(Value) + Send,
) -> Result<Reply, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    let capability = {
        let Ok(data) = session.data.lock() else {
            return Ok(error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR));
        };
        let host = req
            .headers()
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        if !same_host(host, &data)
            || origin.is_some_and(|origin| origin != format!("http://{host}"))
        {
            return Ok(error(StatusCode::FORBIDDEN, "地址或来源不匹配，请重新扫码"));
        }
        if path.starts_with("/api/") && (session.stop.is_cancelled() || !authorized(&req, &data)) {
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                "授权已过期或关闭，请在电视上重新开启并扫码",
            ));
        }
        data.token.clone()
    };
    if method == Method::GET {
        return Ok(match path.as_str() {
            "/" => response(StatusCode::OK, PAGE, "text/html; charset=utf-8"),
            "/app.js" => response(StatusCode::OK, SCRIPT, "text/javascript; charset=utf-8"),
            "/style.css" => response(StatusCode::OK, CSS, "text/css; charset=utf-8"),
            "/api/status" => match snapshot(&session, false) {
                Ok(status) => result(json!(status)),
                Err(_) => error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR),
            },
            _ => error(StatusCode::NOT_FOUND, "未找到"),
        });
    }
    if method == Method::PUT && path.starts_with("/api/upload/") {
        let id = path.trim_start_matches("/api/upload/");
        let upload = {
            let Ok(mut data) = session.data.lock() else {
                return Ok(error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR));
            };
            if !active_capability(&session, &data, &capability) {
                return Ok(error(StatusCode::UNAUTHORIZED, "授权已失效，请重新扫码"));
            }
            match data
                .uploads
                .iter_mut()
                .find(|u| u.id == id && u.status == "ready")
            {
                Some(upload) => {
                    upload.status = "receiving".into();
                    upload.clone()
                }
                None => {
                    return Ok(error(
                        StatusCode::CONFLICT,
                        "请先在电视上批准此批文件，或重新发起上传",
                    ))
                }
            }
        };
        let path = session.dir.join(&upload.id).join(&upload.name);
        let transfer = async {
            tokio::fs::create_dir_all(path.parent().unwrap())
                .await
                .map_err(|_| ())?;
            let mut file = tokio::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .await
                .map_err(|_| ())?;
            let mut body = req.into_body();
            let mut received = 0u64;
            while let Some(frame) = body.frame().await {
                let frame = frame.map_err(|_| ())?;
                if let Some(bytes) = frame.data_ref() {
                    received = received.checked_add(bytes.len() as u64).ok_or(())?;
                    if received > upload.size {
                        return Err(());
                    }
                    file.write_all(bytes).await.map_err(|_| ())?;
                    if let Ok(mut data) = session.data.lock() {
                        if let Some(u) = data.uploads.iter_mut().find(|u| u.id == upload.id) {
                            u.received = received;
                        }
                    }
                }
            }
            if received != upload.size {
                return Err(());
            }
            file.sync_all().await.map_err(|_| ())
        };
        let mut success = tokio::select! { result = tokio::time::timeout(Duration::from_secs(15 * 60), transfer) => matches!(result, Ok(Ok(()))), _ = upload.cancel.cancelled() => false, _ = session.stop.cancelled() => false };
        if let Ok(mut data) = session.data.lock() {
            success = success
                && active_capability(&session, &data, &capability)
                && !upload.cancel.is_cancelled();
            if let Some(u) = data.uploads.iter_mut().find(|u| u.id == upload.id) {
                if u.status == "receiving" {
                    u.status = if success { "complete" } else { "failed" }.into();
                }
            }
        } else {
            success = false;
        }
        if !success {
            let _ = tokio::fs::remove_file(path).await;
        }
        return Ok(if success {
            result(json!({"ok": true}))
        } else {
            error(StatusCode::BAD_REQUEST, "传输失败或已取消，请重新选择文件")
        });
    }
    if method != Method::POST {
        return Ok(error(StatusCode::METHOD_NOT_ALLOWED, "操作不支持"));
    }
    let Ok(body) = json_body(req.into_body()).await else {
        return Ok(error(StatusCode::BAD_REQUEST, "请求格式或大小不正确"));
    };
    if path == "/api/batch" {
        let Ok(files) = serde_json::from_value::<Vec<FileSpec>>(body) else {
            return Ok(error(StatusCode::BAD_REQUEST, "文件列表不正确"));
        };
        if files.is_empty()
            || files.len() > 20
            || !files.iter().all(valid_spec)
            || files.iter().map(|f| f.size).sum::<u64>() > MAX_BATCH
        {
            return Ok(error(StatusCode::BAD_REQUEST, "每批最多 20 本、500 MB，单本 100 MB；支持 TXT / EPUB / PDF / MOBI / AZW3 / FB2 / CBZ"));
        }
        let Ok(mut data) = session.data.lock() else {
            return Ok(error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR));
        };
        if !active_capability(&session, &data, &capability) {
            return Ok(error(StatusCode::UNAUTHORIZED, "授权已失效，请重新扫码"));
        }
        if !data.accepting
            || data.uploads.iter().any(|u| {
                ["pending", "ready", "receiving", "complete", "importing"]
                    .contains(&u.status.as_str())
            })
        {
            return Ok(error(
                StatusCode::CONFLICT,
                "电视已停止接收新文件，或上一批仍在处理",
            ));
        }
        data.uploads.clear();
        let batch = Uuid::new_v4().to_string();
        data.uploads = files
            .into_iter()
            .map(|f| Upload {
                id: Uuid::new_v4().to_string(),
                batch: batch.clone(),
                name: f.name,
                size: f.size,
                received: 0,
                status: "pending".into(),
                cancel: CancellationToken::new(),
            })
            .collect();
        return Ok(result(json!({ "batch": batch, "files": data.uploads })));
    }
    if path == "/api/cancel-batch" {
        let Ok(mut data) = session.data.lock() else {
            return Ok(error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR));
        };
        if !active_capability(&session, &data, &capability) {
            return Ok(error(StatusCode::UNAUTHORIZED, "授权已失效，请重新扫码"));
        }
        let batch = body.get("batch").and_then(Value::as_str).unwrap_or("");
        for upload in &mut data.uploads {
            if upload.batch == batch
                && ["pending", "ready", "receiving"].contains(&upload.status.as_str())
            {
                upload.cancel.cancel();
                upload.status = "cancelled".into();
            }
        }
        return Ok(result(json!({"ok": true})));
    }
    if path == "/api/rpc" {
        let op = body.get("op").and_then(Value::as_str).unwrap_or("");
        if ![
            "getConfig",
            "saveTTS",
            "deleteTTS",
            "testTTS",
            "saveWebDAV",
            "saveOPDS",
            "deleteOPDS",
        ]
        .contains(&op)
        {
            return Ok(error(StatusCode::BAD_REQUEST, "操作不支持"));
        }
        let id = Uuid::new_v4().to_string();
        let (send, receive) = oneshot::channel();
        {
            let Ok(mut data) = session.data.lock() else {
                return Ok(error(StatusCode::SERVICE_UNAVAILABLE, LOCK_ERROR));
            };
            if !active_capability(&session, &data, &capability) {
                return Ok(error(StatusCode::UNAUTHORIZED, "授权已失效，请重新扫码"));
            }
            if data.pending.len() >= 4 {
                return Ok(error(StatusCode::TOO_MANY_REQUESTS, "请等待上一项操作完成"));
            }
            data.pending.insert(id.clone(), send);
        }
        emit(json!({"id": id, "op": op, "data": body.get("data")}));
        let answer = tokio::time::timeout(Duration::from_secs(45), receive).await;
        if let Ok(mut data) = session.data.lock() {
            data.pending.remove(&id);
        }
        return Ok(match answer {
            Ok(Ok(Ok(value))) => result(value),
            Ok(Ok(Err(message))) => error(StatusCode::BAD_REQUEST, &message),
            _ => error(
                StatusCode::GATEWAY_TIMEOUT,
                "电视暂未响应；请保持 Readest 在前台并重试",
            ),
        });
    }
    Ok(error(StatusCode::NOT_FOUND, "未找到"))
}
#[tauri::command]
pub async fn tv_portal_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PortalState>,
) -> Result<PortalStatus, String> {
    let mut stored = state.0.lock().await;
    if let Some(session) = stored.as_ref() {
        if snapshot(session, true)?.active {
            return snapshot(session, true);
        }
        session.stop.cancel();
    }
    let (ips, network) = network_state(&app);
    if ips.is_empty() {
        return Err("没有可用局域网地址，请连接 Wi-Fi 或有线网络".into());
    }
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 8765))
        .await
        .or_else(|_| {
            std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).and_then(|l| {
                l.set_nonblocking(true)?;
                TcpListener::from_std(l)
            })
        })
        .map_err(|_| "无法开启局域网接收服务")?;
    let port = listener.local_addr().map_err(|_| "无法读取端口")?.port();
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法读取缓存目录")?
        .join("tv-portal");
    // Only our fixed cache subdirectory is removed; no path ever comes from the phone.
    let _ = tokio::fs::remove_dir_all(&root).await;
    let dir = root.join(Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|_| "无法创建接收目录")?;
    let session = Arc::new(Session {
        data: Mutex::new(Data {
            port,
            addresses: ips,
            network,
            token: secret(),
            expires_at: now() + TTL,
            accepting: true,
            uploads: Vec::new(),
            pending: HashMap::new(),
        }),
        stop: CancellationToken::new(),
        dir,
    });
    *stored = Some(session.clone());
    let server = session.clone();
    let network_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let permits = Arc::new(Semaphore::new(8));
        loop {
            tokio::select! {
                _ = server.stop.cancelled() => break,
                connection = listener.accept() => {
                    let Ok((stream, peer)) = connection else { break; };
                    if !peer.ip().is_ipv4() { continue; }
                    let Ok(permit) = permits.clone().try_acquire_owned() else { continue; };
                    let s = server.clone(); let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit; let stop = s.stop.clone();
                        let connection = http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10)).max_buf_size(32768).serve_connection(TokioIo::new(stream), service_fn(move |req| {
                            let app = handle.clone();
                            route(req, s.clone(), move |value| { let _ = app.emit("tv-portal-request", value); })
                        }));
                        tokio::select! { _ = tokio::time::timeout(Duration::from_secs(16 * 60), connection) => {}, _ = stop.cancelled() => {} }
                    });
                }
            }
        }
    });
    let monitor = session.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! { _ = monitor.stop.cancelled() => break, _ = tokio::time::sleep(Duration::from_secs(2)) => {} }
            let (ips, fingerprint) = network_state(&network_app);
            if let Ok(mut data) = monitor.data.lock() {
                if now() >= data.expires_at {
                    monitor.stop.cancel();
                    data.pending.clear();
                    break;
                }
                if ips != data.addresses || fingerprint != data.network {
                    rotate(&mut data, ips, fingerprint);
                }
            }
        }
    });
    snapshot(&session, true)
}
#[tauri::command]
pub async fn tv_portal_status(
    state: State<'_, PortalState>,
) -> Result<Option<PortalStatus>, String> {
    state
        .0
        .lock()
        .await
        .as_ref()
        .map(|s| snapshot(s, true))
        .transpose()
}
#[tauri::command]
pub async fn tv_portal_stop(state: State<'_, PortalState>) -> Result<(), String> {
    if let Some(session) = state.0.lock().await.take() {
        session.stop.cancel();
        if let Ok(mut data) = session.data.lock() {
            data.pending.clear();
            for upload in &data.uploads {
                upload.cancel.cancel();
            }
        }
        // Let in-flight writes observe cancellation before best-effort cleanup.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = tokio::fs::remove_dir_all(&session.dir).await;
    }
    Ok(())
}
#[tauri::command]
pub async fn tv_portal_control(
    state: State<'_, PortalState>,
    action: String,
    id: Option<String>,
) -> Result<(), String> {
    let stored = state.0.lock().await;
    let session = stored.as_ref().ok_or("接收未开启")?;
    let mut data = session.data.lock().map_err(|_| LOCK_ERROR)?;
    match action.as_str() {
        "accept-new" => data.accepting = true,
        "stop-new" => data.accepting = false,
        "approve" | "reject" => {
            for u in &mut data.uploads {
                if Some(&u.batch) == id.as_ref() && u.status == "pending" {
                    u.status = if action == "approve" {
                        "ready"
                    } else {
                        "cancelled"
                    }
                    .into();
                }
            }
        }
        "cancel" => {
            for u in &mut data.uploads {
                if Some(&u.id) == id.as_ref()
                    && ["pending", "ready", "receiving"].contains(&u.status.as_str())
                {
                    u.cancel.cancel();
                    u.status = "cancelled".into();
                }
            }
        }
        _ => return Err("操作不支持".into()),
    }
    Ok(())
}
#[tauri::command]
pub async fn tv_portal_respond(
    state: State<'_, PortalState>,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if let Some(session) = state.0.lock().await.as_ref() {
        if let Some(send) = session
            .data
            .lock()
            .map_err(|_| LOCK_ERROR)?
            .pending
            .remove(&id)
        {
            let _ = send.send(if let Some(error) = error {
                Err(error)
            } else {
                Ok(result.unwrap_or(Value::Null))
            });
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn tv_portal_take_upload<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PortalState>,
    id: String,
) -> Result<String, String> {
    let stored = state.0.lock().await;
    let session = stored.as_ref().ok_or("接收未开启")?;
    let mut data = session.data.lock().map_err(|_| LOCK_ERROR)?;
    let upload = data
        .uploads
        .iter_mut()
        .find(|u| u.id == id && u.status == "complete")
        .ok_or("文件未就绪")?;
    let path = session
        .dir
        .join(&upload.id)
        .join(&upload.name)
        .to_string_lossy()
        .into_owned();
    crate::allow_file_in_scopes(&app, vec![PathBuf::from(&path)]);
    upload.status = "importing".into();
    Ok(path)
}
#[tauri::command]
pub async fn tv_portal_finish_upload(
    state: State<'_, PortalState>,
    id: String,
    success: bool,
) -> Result<(), String> {
    let path = {
        let stored = state.0.lock().await;
        let session = stored.as_ref().ok_or("接收未开启")?;
        let mut data = session.data.lock().map_err(|_| LOCK_ERROR)?;
        let upload = data
            .uploads
            .iter_mut()
            .find(|u| u.id == id && u.status == "importing")
            .ok_or("文件状态已变化")?;
        upload.status = if success { "saved" } else { "import-failed" }.into();
        session.dir.join(&upload.id)
    };
    let _ = tokio::fs::remove_dir_all(path).await;
    Ok(())
}
#[tauri::command]
pub async fn tv_portal_request_valid(
    state: State<'_, PortalState>,
    id: String,
) -> Result<bool, String> {
    let stored = state.0.lock().await;
    let Some(session) = stored.as_ref() else {
        return Ok(false);
    };
    let data = session.data.lock().map_err(|_| LOCK_ERROR)?;
    Ok(!session.stop.is_cancelled() && now() < data.expires_at && data.pending.contains_key(&id))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn test_server() -> (Arc<Session>, String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let session = Arc::new(Session {
            data: Mutex::new(Data {
                port,
                addresses: vec!["127.0.0.1".into()],
                network: "test".into(),
                token: secret(),
                expires_at: now() + TTL,
                accepting: true,
                uploads: vec![],
                pending: HashMap::new(),
            }),
            stop: CancellationToken::new(),
            dir: std::env::temp_dir().join(format!("readest-tv-portal-test-{}", Uuid::new_v4())),
        });
        tokio::fs::create_dir_all(&session.dir).await.unwrap();
        let server = session.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = server.stop.cancelled() => break,
                    connection = listener.accept() => {
                        let (socket, _) = connection.unwrap();
                        let session = server.clone();
                        tokio::spawn(async move {
                            let _ = http1::Builder::new().serve_connection(TokioIo::new(socket), service_fn(move |request| route(request, session.clone(), |_| {}))).await;
                        });
                    }
                }
            }
        });
        (session, format!("http://127.0.0.1:{port}"), task)
    }
    async fn stop_test(session: Arc<Session>, task: tokio::task::JoinHandle<()>) {
        session.stop.cancel();
        task.await.unwrap();
        tokio::fs::remove_dir_all(&session.dir).await.unwrap();
    }
    #[tokio::test]
    async fn http_authorization_batch_approval_upload_and_revocation() {
        let (session, url, task) = test_server().await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let token = session.data.lock().unwrap().token.clone();
        let page = client.get(&url).send().await.unwrap();
        assert_eq!(page.status(), 200);
        assert_eq!(page.headers()["x-content-type-options"], "nosniff");
        assert!(page.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("default-src 'none'"));
        assert_eq!(
            client
                .get(format!("{url}/api/status"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .get(format!("{url}/api/status"))
                .bearer_auth(&token)
                .header("Origin", "https://unrelated.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .get(format!("{url}/api/status"))
                .bearer_auth(&token)
                .header("Host", "rebinding.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let status: Value = client
            .get(format!("{url}/api/status"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(status["token"], "");
        assert_eq!(
            client
                .post(format!("{url}/api/batch"))
                .bearer_auth(&token)
                .json(&json!([{"name":"../bad.txt","size":3}]))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        let text = "第一章：电视阅读";
        let batch: Value = client
            .post(format!("{url}/api/batch"))
            .bearer_auth(&token)
            .json(&json!([{"name":"小说.txt","size":text.len()}]))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let id = batch["files"][0]["id"].as_str().unwrap();
        let upload_url = format!("{url}/api/upload/{id}");
        assert_eq!(
            client
                .put(&upload_url)
                .bearer_auth(&token)
                .body(text)
                .send()
                .await
                .unwrap()
                .status(),
            409
        );
        session.data.lock().unwrap().uploads[0].status = "ready".into();
        assert_eq!(
            client
                .put(&upload_url)
                .bearer_auth(&token)
                .body(text)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(session.data.lock().unwrap().uploads[0].status, "complete");
        assert_eq!(
            tokio::fs::read_to_string(session.dir.join(id).join("小说.txt"))
                .await
                .unwrap(),
            text
        );
        rotate(
            &mut session.data.lock().unwrap(),
            vec!["127.0.0.1".into()],
            "new-interface-same-ip".into(),
        );
        assert_eq!(
            client
                .get(format!("{url}/api/status"))
                .bearer_auth(&token)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        stop_test(session, task).await;
    }
    #[tokio::test]
    async fn phone_cancellation_releases_pending_batch_and_size_mismatch_fails() {
        let (session, url, task) = test_server().await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let token = session.data.lock().unwrap().token.clone();
        let files = json!([{"name":"book.txt","size":3}]);
        let batch: Value = client
            .post(format!("{url}/api/batch"))
            .bearer_auth(&token)
            .json(&files)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(
            client
                .post(format!("{url}/api/cancel-batch"))
                .bearer_auth(&token)
                .json(&json!({"batch":batch["batch"]}))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(session.data.lock().unwrap().uploads[0].status, "cancelled");
        let next: Value = client
            .post(format!("{url}/api/batch"))
            .bearer_auth(&token)
            .json(&files)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let id = next["files"][0]["id"].as_str().unwrap();
        session.data.lock().unwrap().uploads[0].status = "ready".into();
        assert_eq!(
            client
                .put(format!("{url}/api/upload/{id}"))
                .bearer_auth(&token)
                .body("too long")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        assert_eq!(session.data.lock().unwrap().uploads[0].status, "failed");
        assert!(!session.dir.join(id).join("book.txt").exists());
        stop_test(session, task).await;
    }
    #[tokio::test]
    async fn request_started_before_rotation_cannot_commit_after_rotation() {
        use tokio::io::AsyncReadExt;
        let (session, url, task) = test_server().await;
        let token = session.data.lock().unwrap().token.clone();
        let authority = url.trim_start_matches("http://");
        let mut socket = tokio::net::TcpStream::connect(authority).await.unwrap();
        let body = r#"[{"name":"book.txt","size":3}]"#;
        let headers = format!("POST /api/batch HTTP/1.1\r\nHost: {authority}\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.write_all(&body.as_bytes()[..1]).await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        rotate(
            &mut session.data.lock().unwrap(),
            vec!["127.0.0.1".into()],
            "new-network".into(),
        );
        socket.write_all(&body.as_bytes()[1..]).await.unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 401"));
        assert!(session.data.lock().unwrap().uploads.is_empty());
        stop_test(session, task).await;
    }
    #[test]
    fn accepts_books_but_never_paths_or_executables() {
        for name in ["小说.txt", "book.EPUB", "manual.pdf"] {
            assert!(valid_spec(&FileSpec {
                name: name.into(),
                size: 123
            }));
        }
        for name in [
            "../a.txt",
            "a/b.txt",
            "a\\b.txt",
            "C:a.txt",
            ".hidden.txt",
            "x.apk",
            "x\n.txt",
        ] {
            assert!(!valid_spec(&FileSpec {
                name: name.into(),
                size: 123
            }));
        }
        assert!(!valid_spec(&FileSpec {
            name: "x.txt".into(),
            size: MAX_FILE + 1
        }));
    }
    #[test]
    fn host_must_be_the_advertised_interface_and_actual_port() {
        let data = Data {
            port: 9999,
            network: String::new(),
            addresses: vec!["192.168.1.2".into()],
            token: secret(),
            expires_at: now() + TTL,
            accepting: true,
            uploads: vec![],
            pending: HashMap::new(),
        };
        assert!(same_host("192.168.1.2:9999", &data));
        for host in [
            "localhost:9999",
            "0.0.0.0:9999",
            "evil.example:9999",
            "192.168.1.2:8765",
        ] {
            assert!(!same_host(host, &data));
        }
    }
    #[test]
    fn network_change_revokes_capability_and_pending_batch() {
        let mut data = Data {
            port: 9999,
            network: String::new(),
            addresses: vec![],
            token: secret(),
            expires_at: now() + TTL,
            accepting: true,
            uploads: vec![Upload {
                id: "1".into(),
                batch: "b".into(),
                name: "book.txt".into(),
                size: 1,
                received: 0,
                status: "ready".into(),
                cancel: CancellationToken::new(),
            }],
            pending: HashMap::new(),
        };
        let old = data.token.clone();
        rotate(&mut data, vec!["192.168.2.2".into()], "network-b".into());
        assert_ne!(old, data.token);
        assert_eq!(data.uploads[0].status, "cancelled");
        assert!(data.uploads[0].cancel.is_cancelled());
    }
}
