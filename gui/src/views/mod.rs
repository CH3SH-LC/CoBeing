use serde::Deserialize;

// ---- 数据模型 ----

#[derive(Debug, Clone)]
pub struct LogMessage {
    pub direction: String,
    pub content: String,
    pub timestamp: i64,
}

impl LogMessage {
    pub fn timestamp_short(&self) -> String {
        let secs = self.timestamp / 1000;
        chrono_from_millis(secs)
    }
}

fn chrono_from_millis(secs: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let diff = now - secs;
    if diff < 60 {
        format!("{}s ago", diff)
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else {
        format!("{}h ago", diff / 3600)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    pub status: String,
    pub model: String,
    pub provider: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub members: Vec<String>,
    pub protocol: String,
    #[serde(default)]
    pub topic: Option<String>,
}

// ---- 创建对话框 ----

#[derive(Debug, Clone, Default)]
pub struct CreateAgentDialog {
    pub open: bool,
    pub name: String,
    pub role: String,
    pub system_prompt: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Default)]
pub struct CreateGroupDialog {
    pub open: bool,
    pub name: String,
    pub selected_members: Vec<String>,  // 选中的 agent IDs
    pub topic: String,
}

// ---- 侧边栏 Tab ----

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum SidebarTab {
    #[default]
    Agents,
    Groups,
}

// ---- App 全局状态 ----

#[derive(Debug, Default)]
pub struct AppState {
    pub connected: bool,
    pub agents: Vec<AgentInfo>,
    pub groups: Vec<GroupInfo>,
    pub channels: Vec<String>,
    pub messages: Vec<LogMessage>,
    pub selected_agent: Option<String>,
    pub selected_group: Option<String>,
    pub waiting_for_response: bool,
    pub stream_buffer: String,

    // UI 状态
    pub sidebar_tab: SidebarTab,
    pub create_agent_dialog: CreateAgentDialog,
    pub create_group_dialog: CreateGroupDialog,
}

impl AppState {
    pub fn add_out(&mut self, content: &str) {
        self.waiting_for_response = false;
        self.stream_buffer.clear();
        self.messages.push(LogMessage {
            direction: "out".into(),
            content: content.into(),
            timestamp: now_millis(),
        });
    }

    pub fn add_system(&mut self, content: &str) {
        self.waiting_for_response = false;
        self.stream_buffer.clear();
        self.messages.push(LogMessage {
            direction: "system".into(),
            content: content.into(),
            timestamp: now_millis(),
        });
    }

    pub fn start_waiting(&mut self) {
        self.waiting_for_response = true;
        self.stream_buffer.clear();
    }

    pub fn append_stream_token(&mut self, token: &str) {
        self.stream_buffer.push_str(token);
    }

    pub fn finalize_stream(&mut self, content: &str) {
        self.waiting_for_response = false;
        let final_content = if self.stream_buffer.is_empty() {
            content.to_string()
        } else {
            std::mem::take(&mut self.stream_buffer)
        };
        self.messages.push(LogMessage {
            direction: "out".into(),
            content: final_content,
            timestamp: now_millis(),
        });
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
