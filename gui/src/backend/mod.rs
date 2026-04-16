use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

use crate::views::{AgentInfo, GroupInfo, LogMessage};

// ---- 消息类型 ----

pub enum BackendMsg {
    Connected,
    Disconnected,
    State {
        agents: Vec<AgentInfo>,
        groups: Vec<GroupInfo>,
        channels: Vec<String>,
    },
    Message(LogMessage),
    StreamToken(String),
    AgentResponse { content: String },
    Error(String),
}

pub enum FrontendMsg {
    Send(String),
}

// ---- 后端 ----

pub struct WsBackend {
    recv: Arc<Mutex<Receiver<BackendMsg>>>,
    send_out: Sender<FrontendMsg>,
}

impl WsBackend {
    pub fn new(url: &str, _to_app: Sender<BackendMsg>) -> Self {
        let (tx, rx) = mpsc::channel::<BackendMsg>();
        let (send_out, rx_out) = mpsc::channel::<FrontendMsg>();

        let url = url.to_string();
        let recv = Arc::new(Mutex::new(rx));

        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("tokio runtime");
            rt.block_on(ws_loop(&url, &tx, &rx_out));
        });

        Self { recv, send_out }
    }

    pub fn try_recv(&self) -> Result<BackendMsg, mpsc::TryRecvError> {
        self.recv.lock().unwrap().try_recv()
    }

    pub fn sender(&self) -> Sender<FrontendMsg> {
        self.send_out.clone()
    }
}

// ---- WS 事件循环 ----

async fn ws_loop(
    url: &str,
    to_app: &Sender<BackendMsg>,
    from_app: &Receiver<FrontendMsg>,
) {
    loop {
        match connect_and_run(url, to_app, from_app).await {
            Ok(()) => {}
            Err(e) => {
                let _ = to_app.send(BackendMsg::Error(format!("WS: {e}")));
            }
        }
        let _ = to_app.send(BackendMsg::Disconnected);
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    }
}

async fn connect_and_run(
    url: &str,
    to_app: &Sender<BackendMsg>,
    from_app: &Receiver<FrontendMsg>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures_util::StreamExt;
    use tokio_tungstenite::tungstenite::Message;

    let (ws_stream, _) = tokio_tungstenite::connect_async(url).await?;
    let _ = to_app.send(BackendMsg::Connected);
    let (mut write, mut read) = ws_stream.split();

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let _ = handle_ws_message(&text, to_app);
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    _ => {}
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(50)) => {
                while let Ok(FrontendMsg::Send(text)) = from_app.try_recv() {
                    use futures_util::SinkExt;
                    write.send(Message::Text(text.into())).await?;
                }
            }
        }
    }
}

fn handle_ws_message(text: &str, to_app: &Sender<BackendMsg>) -> Result<(), serde_json::Error> {
    let val: serde_json::Value = serde_json::from_str(text)?;
    let msg_type = val["type"].as_str().unwrap_or("");

    match msg_type {
        "state" => {
            let agents: Vec<AgentInfo> = serde_json::from_value(val["payload"]["agents"].clone()).unwrap_or_default();
            let groups: Vec<GroupInfo> = serde_json::from_value(val["payload"]["groups"].clone()).unwrap_or_default();
            let channels: Vec<String> = val["payload"]["channels"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let _ = to_app.send(BackendMsg::State { agents, groups, channels });
        }
        "message" => {
            let direction = val["payload"]["direction"].as_str().unwrap_or("system").to_string();
            let content = val["payload"]["content"].as_str().unwrap_or("").to_string();
            let timestamp = val["payload"]["timestamp"].as_i64().unwrap_or(now_millis());
            let _ = to_app.send(BackendMsg::Message(LogMessage { direction, content, timestamp }));
        }
        "stream_token" => {
            if let Some(token) = val["payload"]["token"].as_str() {
                let _ = to_app.send(BackendMsg::StreamToken(token.to_string()));
            }
        }
        "agent_response" => {
            let content = val["payload"]["content"].as_str().unwrap_or("").to_string();
            let _ = to_app.send(BackendMsg::AgentResponse { content });
        }
        "error" => {
            let message = val["payload"]["message"].as_str().unwrap_or("Unknown error").to_string();
            let _ = to_app.send(BackendMsg::Error(message));
        }
        _ => {}
    }
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
