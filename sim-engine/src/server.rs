use axum::{
    extract::State,
    response::IntoResponse,
    routing::get,
    Router,
};
use axum::http::{header, Response};
use axum::body::Body;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::watch;

pub struct StreamState {
    pub tx: watch::Sender<Vec<u8>>,
    pub rx: watch::Receiver<Vec<u8>>,
}

impl StreamState {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(Vec::new());
        Self { tx, rx }
    }
}

pub async fn start_mjpeg_server(state: Arc<Mutex<StreamState>>) -> Result<u16, std::io::Error> {
    let app = Router::new()
        .route("/stream.mjpeg", get(mjpeg_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    
    Ok(port)
}

async fn mjpeg_handler(State(state): State<Arc<Mutex<StreamState>>>) -> impl IntoResponse {
    let mut rx = {
        let state = state.lock().await;
        state.rx.clone()
    };

    let stream = async_stream::stream! {
        loop {
            if rx.changed().await.is_err() {
                break;
            }
            let frame = rx.borrow().clone();
            if !frame.is_empty() {
                let mut chunk = Vec::new();
                chunk.extend_from_slice(b"--frame\r\n");
                chunk.extend_from_slice(b"Content-Type: image/jpeg\r\n");
                chunk.extend_from_slice(format!("Content-Length: {}\r\n\r\n", frame.len()).as_bytes());
                chunk.extend_from_slice(&frame);
                chunk.extend_from_slice(b"\r\n");
                yield Ok::<_, std::convert::Infallible>(chunk);
            }
        }
    };

    Response::builder()
        .header(header::CONTENT_TYPE, "multipart/x-mixed-replace; boundary=frame")
        .body(Body::from_stream(stream))
        .unwrap()
}
