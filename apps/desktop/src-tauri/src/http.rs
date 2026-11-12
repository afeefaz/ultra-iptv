//! Provider requests without the web page's limits (CORS, App Transport Security): the catalogue
//! worker sends them here when its own `fetch` can't reach a provider (core/net/http.ts fallback).
//! Addresses contain logins, so no URL is ever logged or put in an error message.
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Response;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("HTTP client")
    })
}

/** What a failed request says, without its address. */
pub fn describe(e: reqwest::Error) -> String {
    let e = e.without_url();
    if e.is_timeout() {
        "timeout".into()
    } else if e.is_connect() {
        "could not connect".into()
    } else {
        e.to_string()
    }
}

pub fn build_get(
    url: &str,
    headers: &HashMap<String, String>,
    timeout_ms: u64,
) -> reqwest::RequestBuilder {
    let mut req = client()
        .get(url)
        .timeout(Duration::from_millis(timeout_ms.max(1000)));
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    req
}

/** The whole answer as "<status>\n<body>": sent as raw text, so a 100 MB list isn't escaped into JSON. */
#[tauri::command]
pub async fn http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: u64,
) -> Result<Response, String> {
    let res = build_get(&url, &headers.unwrap_or_default(), timeout_ms)
        .send()
        .await
        .map_err(describe)?;
    let status = res.status().as_u16();
    let body = res.bytes().await.map_err(describe)?;
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(status.to_string().as_bytes());
    out.push(b'\n');
    out.extend_from_slice(&body);
    Ok(Response::new(out))
}
