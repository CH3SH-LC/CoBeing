#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use eframe::egui;
use std::sync::mpsc;
use std::time::Duration;

mod backend;
mod views;

use views::{AppState, SidebarTab};

// ═══════════════════════════════════════════════════════════════
// Palette — "Deep Space Terminal" / Tokyo Night inspired
// ═══════════════════════════════════════════════════════════════

#[derive(Clone)]
struct Palette {
    // Backgrounds
    bg_base: egui::Color32,
    bg_surface: egui::Color32,
    bg_elevated: egui::Color32,
    bg_hover: egui::Color32,
    bg_input: egui::Color32,

    // Accents
    accent: egui::Color32,
    accent_dim: egui::Color32,
    success: egui::Color32,
    warning: egui::Color32,
    danger: egui::Color32,
    purple: egui::Color32,

    // Text
    text: egui::Color32,
    text_sub: egui::Color32,
    text_muted: egui::Color32,

    // Message bubbles
    user_bg: egui::Color32,
    user_accent: egui::Color32,
    asst_bg: egui::Color32,
    asst_accent: egui::Color32,
    sys_bg: egui::Color32,
    sys_accent: egui::Color32,

    // Borders
    border: egui::Color32,
    border_focus: egui::Color32,
}

impl Palette {
    fn new() -> Self {
        Self {
            bg_base:     egui::Color32::from_rgb(26, 27, 38),
            bg_surface:  egui::Color32::from_rgb(22, 22, 30),
            bg_elevated: egui::Color32::from_rgb(31, 32, 48),
            bg_hover:    egui::Color32::from_rgb(40, 42, 62),
            bg_input:    egui::Color32::from_rgb(20, 20, 28),

            accent:      egui::Color32::from_rgb(122, 162, 247),
            accent_dim:  egui::Color32::from_rgb(55, 75, 130),
            success:     egui::Color32::from_rgb(158, 206, 106),
            warning:     egui::Color32::from_rgb(224, 175, 104),
            danger:      egui::Color32::from_rgb(247, 118, 142),
            purple:      egui::Color32::from_rgb(187, 154, 247),

            text:        egui::Color32::from_rgb(192, 202, 245),
            text_sub:    egui::Color32::from_rgb(169, 177, 214),
            text_muted:  egui::Color32::from_rgb(86, 95, 137),

            user_bg:     egui::Color32::from_rgb(28, 38, 72),
            user_accent: egui::Color32::from_rgb(122, 162, 247),
            asst_bg:     egui::Color32::from_rgb(22, 38, 28),
            asst_accent: egui::Color32::from_rgb(158, 206, 106),
            sys_bg:      egui::Color32::from_rgb(38, 34, 22),
            sys_accent:  egui::Color32::from_rgb(224, 175, 104),

            border:      egui::Color32::from_rgb(41, 46, 66),
            border_focus:egui::Color32::from_rgb(59, 66, 97),
        }
    }

    fn status_color(&self, status: &str) -> egui::Color32 {
        match status {
            "idle" => self.success,
            "running" => self.warning,
            _ => self.danger,
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("MyAgents"),
        ..Default::default()
    };

    eframe::run_native(
        "MyAgents",
        options,
        Box::new(|cc| {
            // Load Chinese font
            let mut fonts = egui::FontDefinitions::default();
            if let Ok(font_data) = std::fs::read("C:/Windows/Fonts/msyh.ttc") {
                fonts.font_data.insert(
                    "msyh".into(),
                    std::sync::Arc::new(egui::FontData::from_owned(font_data)),
                );
                for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
                    fonts.families.entry(family).or_default().insert(0, "msyh".into());
                }
            }
            cc.egui_ctx.set_fonts(fonts);

            // Apply theme
            let p = Palette::new();
            let mut style = (*cc.egui_ctx.style()).clone();
            style.visuals = egui::Visuals {
                dark_mode: true,
                override_text_color: Some(p.text),
                widgets: egui::style::Widgets {
                    noninteractive: egui::style::WidgetVisuals {
                        bg_fill: p.bg_surface,
                        weak_bg_fill: p.bg_base,
                        fg_stroke: egui::Stroke::new(1.0, p.text),
                        bg_stroke: egui::Stroke::new(1.0, p.border),
                        corner_radius: egui::CornerRadius::same(4),
                        expansion: 0.0,
                    },
                    inactive: egui::style::WidgetVisuals {
                        bg_fill: p.bg_input,
                        weak_bg_fill: p.bg_input,
                        fg_stroke: egui::Stroke::new(1.0, p.text),
                        bg_stroke: egui::Stroke::new(1.0, p.border),
                        corner_radius: egui::CornerRadius::same(4),
                        expansion: 0.0,
                    },
                    hovered: egui::style::WidgetVisuals {
                        bg_fill: p.bg_hover,
                        weak_bg_fill: p.bg_hover,
                        fg_stroke: egui::Stroke::new(1.0, p.accent),
                        bg_stroke: egui::Stroke::new(1.5, p.accent),
                        corner_radius: egui::CornerRadius::same(4),
                        expansion: 0.5,
                    },
                    active: egui::style::WidgetVisuals {
                        bg_fill: p.accent_dim,
                        weak_bg_fill: p.accent_dim,
                        fg_stroke: egui::Stroke::new(1.0, egui::Color32::WHITE),
                        bg_stroke: egui::Stroke::new(2.0, p.accent),
                        corner_radius: egui::CornerRadius::same(4),
                        expansion: 1.0,
                    },
                    ..Default::default()
                },
                selection: egui::style::Selection {
                    bg_fill: p.accent.linear_multiply(0.25),
                    stroke: egui::Stroke::new(1.0, p.accent),
                },
                ..Default::default()
            };
            cc.egui_ctx.set_style(style);

            Ok(Box::new(MyAgentsApp::new()))
        }),
    )
}

// ═══════════════════════════════════════════════════════════════
// App state
// ═══════════════════════════════════════════════════════════════

struct MyAgentsApp {
    backend: backend::WsBackend,
    state: AppState,
    palette: Palette,
    input_text: String,
}

impl MyAgentsApp {
    fn new() -> Self {
        let (tx, _rx) = mpsc::channel();
        Self {
            backend: backend::WsBackend::new("ws://localhost:18765", tx),
            state: AppState::default(),
            palette: Palette::new(),
            input_text: String::new(),
        }
    }

    fn poll_backend(&mut self) {
        while let Ok(msg) = self.backend.try_recv() {
            match msg {
                backend::BackendMsg::Connected => {
                    self.state.connected = true;
                    self.state.add_system("Connected to core");
                }
                backend::BackendMsg::Disconnected => {
                    self.state.connected = false;
                    self.state.add_system("Disconnected from core");
                }
                backend::BackendMsg::State { agents, groups, channels } => {
                    self.state.agents = agents;
                    self.state.groups = groups;
                    self.state.channels = channels;
                    if self.state.selected_agent.is_none() {
                        if let Some(a) = self.state.agents.first() {
                            self.state.selected_agent = Some(a.id.clone());
                        }
                    }
                }
                backend::BackendMsg::Message(m) => {
                    if m.direction == "in" {
                        self.state.messages.push(m);
                    }
                }
                backend::BackendMsg::StreamToken(token) => {
                    self.state.append_stream_token(&token);
                }
                backend::BackendMsg::AgentResponse { content } => {
                    self.state.finalize_stream(&content);
                }
                backend::BackendMsg::Error(e) => {
                    self.state.add_system(&format!("Error: {e}"));
                }
            }
        }
    }

    fn send_message(&mut self) {
        let text = self.input_text.trim().to_string();
        if text.is_empty() { return; }
        self.input_text.clear();
        let agent_id = self.state.selected_agent.clone();
        self.state.start_waiting();

        let sender = self.backend.sender();
        std::thread::spawn(move || {
            let msg = serde_json::json!({
                "type": "send_message",
                "payload": { "agentId": agent_id.unwrap_or_default(), "content": text }
            });
            let _ = sender.send(backend::FrontendMsg::Send(msg.to_string()));
        });
    }

    fn send_command(&self, command: &str) {
        let sender = self.backend.sender();
        let cmd = command.to_string();
        std::thread::spawn(move || {
            let _ = sender.send(backend::FrontendMsg::Send(cmd));
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// App trait — main render loop
// ═══════════════════════════════════════════════════════════════

impl eframe::App for MyAgentsApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_backend();
        ctx.request_repaint_after(Duration::from_millis(100));

        let p = self.palette.clone();

        // Snapshot data for closures
        let connected = self.state.connected;
        let agent_count = self.state.agents.len();
        let group_count = self.state.groups.len();
        let agents = self.state.agents.clone();
        let groups = self.state.groups.clone();
        let selected_agent = self.state.selected_agent.clone();
        let selected_group = self.state.selected_group.clone();
        let tab = self.state.sidebar_tab;
        let waiting = self.state.waiting_for_response;
        let input_empty = self.input_text.trim().is_empty();
        let messages = self.state.messages.clone();
        let stream_buffer = self.state.stream_buffer.clone();
        let available_agents = self.state.agents.clone();

        // Deferred actions
        let mut should_send = false;

        // ─── Top Bar ───────────────────────────────────────────
        egui::TopBottomPanel::top("top_bar")
            .exact_height(44.0)
            .show(ctx, |ui| {
                // Background
                let rect = ui.available_rect_before_wrap();
                ui.painter().rect_filled(rect, egui::CornerRadius::default(), p.bg_surface);

                ui.horizontal(|ui| {
                    ui.add_space(14.0);
                    ui.vertical_centered(|ui| {
                        ui.add_space(12.0);
                        ui.label(egui::RichText::new("MyAgents").size(16.0).color(p.accent).strong());
                    });
                    ui.add_space(16.0);

                    // Connection status
                    let (dot_col, status_text) = if connected {
                        (p.success, "Connected")
                    } else {
                        (p.danger, "Offline")
                    };
                    let cursor = ui.cursor().left_top();
                    let dot_center = cursor + egui::vec2(4.0, 16.0);
                    // Glow
                    ui.painter().circle_filled(
                        dot_center, 7.0,
                        egui::Color32::from_rgba_premultiplied(dot_col.r(), dot_col.g(), dot_col.b(), 30),
                    );
                    ui.painter().circle_filled(dot_center, 3.5, dot_col);
                    ui.add_space(12.0);
                    ui.label(egui::RichText::new(status_text).size(11.0).color(dot_col));
                    ui.add_space(20.0);

                    ui.label(egui::RichText::new(format!("{} Agents", agent_count)).size(11.0).color(p.text_muted));
                    ui.add_space(4.0);
                    ui.label(egui::RichText::new("·").size(11.0).color(p.text_muted));
                    ui.add_space(4.0);
                    ui.label(egui::RichText::new(format!("{} Groups", group_count)).size(11.0).color(p.text_muted));
                });

                // Bottom accent line
                let rect = ui.available_rect_before_wrap();
                ui.painter().line_segment(
                    [rect.left_top(), rect.right_top()],
                    egui::Stroke::new(1.0, p.border),
                );
            });

        // ─── Input Panel ───────────────────────────────────────
        let send_enabled = !input_empty && !waiting;

        egui::TopBottomPanel::bottom("input_panel")
            .exact_height(56.0)
            .show(ctx, |ui| {
                let rect = ui.available_rect_before_wrap();
                ui.painter().rect_filled(rect, egui::CornerRadius::default(), p.bg_surface);
                ui.painter().line_segment(
                    [rect.left_top(), rect.right_top()],
                    egui::Stroke::new(1.0, p.border),
                );
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.add_space(10.0);
                    let resp = ui.add(
                        egui::TextEdit::multiline(&mut self.input_text)
                            .hint_text(egui::RichText::new("输入消息...").color(p.text_muted))
                            .desired_width(f32::INFINITY)
                            .desired_rows(1)
                            .font(egui::TextStyle::Body),
                    );
                    let enter = resp.has_focus()
                        && ui.input(|i| i.key_pressed(egui::Key::Enter) && !i.modifiers.shift);

                    let btn_bg = if send_enabled { p.accent } else { p.border };
                    let btn_text_col = if send_enabled { egui::Color32::WHITE } else { p.text_muted };
                    let send_btn = ui.add_sized(
                        [68.0, 32.0],
                        egui::Button::new(
                            egui::RichText::new("Send").size(12.0).color(btn_text_col).strong(),
                        ).fill(btn_bg).stroke(egui::Stroke::NONE),
                    );
                    ui.add_space(6.0);

                    if (send_btn.clicked() || enter) && send_enabled {
                        should_send = true;
                    }
                });
                ui.horizontal(|ui| {
                    ui.add_space(16.0);
                    ui.label(egui::RichText::new("Enter 发送 · Shift+Enter 换行").size(9.0).color(p.text_muted));
                });
            });

        if should_send {
            self.send_message();
        }

        // ─── Sidebar ───────────────────────────────────────────
        let p_sb = p.clone();
        egui::SidePanel::left("sidebar")
            .min_width(260.0)
            .max_width(280.0)
            .frame(egui::Frame::NONE.fill(p.bg_surface))
            .show(ctx, |ui| {
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.add_space(12.0);
                    // Tab: Agents
                    let agents_active = tab == SidebarTab::Agents;
                    let agents_resp = ui.add_sized(
                        [110.0, 28.0],
                        egui::Button::new(
                            egui::RichText::new("Agents")
                                .size(12.0)
                                .color(if agents_active { p_sb.accent } else { p_sb.text_muted })
                                .strong(),
                        ).fill(egui::Color32::TRANSPARENT).stroke(egui::Stroke::NONE),
                    );
                    // Underline for active tab
                    if agents_active {
                        let underline_rect = agents_resp.rect;
                        ui.painter().line_segment(
                            [underline_rect.left_bottom() + egui::vec2(8.0, -2.0),
                             underline_rect.right_bottom() + egui::vec2(-8.0, -2.0)],
                            egui::Stroke::new(2.0, p_sb.accent),
                        );
                    }
                    if agents_resp.clicked() {
                        self.state.sidebar_tab = SidebarTab::Agents;
                    }

                    // Tab: Groups
                    let groups_active = tab == SidebarTab::Groups;
                    let groups_resp = ui.add_sized(
                        [110.0, 28.0],
                        egui::Button::new(
                            egui::RichText::new("Groups")
                                .size(12.0)
                                .color(if groups_active { p_sb.purple } else { p_sb.text_muted })
                                .strong(),
                        ).fill(egui::Color32::TRANSPARENT).stroke(egui::Stroke::NONE),
                    );
                    if groups_active {
                        let underline_rect = groups_resp.rect;
                        ui.painter().line_segment(
                            [underline_rect.left_bottom() + egui::vec2(8.0, -2.0),
                             underline_rect.right_bottom() + egui::vec2(-8.0, -2.0)],
                            egui::Stroke::new(2.0, p_sb.purple),
                        );
                    }
                    if groups_resp.clicked() {
                        self.state.sidebar_tab = SidebarTab::Groups;
                    }
                });

                ui.add_space(6.0);
                // Separator
                let sep_rect = ui.available_rect_before_wrap();
                ui.painter().line_segment(
                    [egui::pos2(sep_rect.left() + 12.0, sep_rect.top()),
                     egui::pos2(sep_rect.right() - 12.0, sep_rect.top())],
                    egui::Stroke::new(1.0, p_sb.border),
                );
                ui.add_space(6.0);

                match tab {
                    SidebarTab::Agents => {
                        // Create button
                        let create_resp = ui.add_sized(
                            [ui.available_width() - 24.0, 30.0],
                            egui::Button::new(
                                egui::RichText::new("+ 创建 Agent").size(11.0).color(egui::Color32::WHITE).strong(),
                            ).fill(p_sb.accent_dim).stroke(egui::Stroke::new(1.0, p_sb.accent)),
                        );
                        if create_resp.clicked() {
                            self.state.create_agent_dialog.open = true;
                            self.state.create_agent_dialog.name.clear();
                            self.state.create_agent_dialog.role.clear();
                            self.state.create_agent_dialog.system_prompt.clear();
                            self.state.create_agent_dialog.provider = "deepseek".into();
                            self.state.create_agent_dialog.model = "deepseek-chat".into();
                        }
                        ui.add_space(8.0);

                        if agents.is_empty() {
                            ui.vertical_centered(|ui| {
                                ui.add_space(40.0);
                                ui.label(egui::RichText::new("暂无 Agent").size(13.0).color(p_sb.text_muted));
                                ui.add_space(6.0);
                                ui.label(egui::RichText::new("点击上方按钮创建").size(11.0).color(p_sb.text_muted));
                            });
                        } else {
                            egui::ScrollArea::vertical().show(ui, |ui| {
                                for a in &agents {
                                    let sel = selected_agent.as_deref() == Some(&a.id);
                                    let status_col = p_sb.status_color(&a.status);

                                    let card_resp = ui.allocate_ui(
                                        egui::vec2(ui.available_width(), 58.0),
                                        |ui| {
                                            let rect = ui.available_rect_before_wrap();
                                            let bg = if sel { p_sb.bg_elevated } else { p_sb.bg_base };
                                            ui.painter().rect_filled(rect, egui::CornerRadius::same(4), bg);

                                            // Left accent bar
                                            if sel {
                                                ui.painter().rect_filled(
                                                    egui::Rect::from_min_max(rect.left_top(), rect.left_bottom() + egui::vec2(3.0, 0.0)),
                                                    egui::CornerRadius::default(),
                                                    p_sb.accent,
                                                );
                                            }

                                            // Selection border
                                            if sel {
                                                ui.painter().rect_stroke(
                                                    rect, egui::CornerRadius::same(4),
                                                    egui::Stroke::new(1.0, p_sb.accent),
                                                    egui::StrokeKind::Outside,
                                                );
                                            }

                                            ui.add_space(8.0);
                                            ui.horizontal(|ui| {
                                                ui.add_space(14.0);
                                                // Status dot with glow
                                                let cursor = ui.cursor().left_top();
                                                let dot_pos = cursor + egui::vec2(4.0, 8.0);
                                                ui.painter().circle_filled(
                                                    dot_pos, 7.0,
                                                    egui::Color32::from_rgba_premultiplied(
                                                        status_col.r(), status_col.g(), status_col.b(), 35,
                                                    ),
                                                );
                                                ui.painter().circle_filled(dot_pos, 3.0, status_col);
                                                ui.add_space(14.0);

                                                ui.vertical(|ui| {
                                                    ui.label(
                                                        egui::RichText::new(&a.name)
                                                            .size(13.0).color(p_sb.text).strong(),
                                                    );
                                                    ui.horizontal(|ui| {
                                                        if !a.role.is_empty() {
                                                            ui.label(egui::RichText::new(&a.role).size(10.0).color(p_sb.text_sub));
                                                            ui.label(egui::RichText::new("·").size(10.0).color(p_sb.text_muted));
                                                        }
                                                        ui.label(
                                                            egui::RichText::new(format!("{} / {}", a.model, a.provider))
                                                                .size(10.0).color(p_sb.text_muted),
                                                        );
                                                    });
                                                });
                                            });
                                        },
                                    );

                                    if card_resp.response.clicked() {
                                        self.state.selected_agent = Some(a.id.clone());
                                    }
                                    ui.add_space(3.0);
                                }
                            });
                        }
                    }
                    SidebarTab::Groups => {
                        let create_resp = ui.add_sized(
                            [ui.available_width() - 24.0, 30.0],
                            egui::Button::new(
                                egui::RichText::new("+ 创建 Group").size(11.0).color(egui::Color32::WHITE).strong(),
                            ).fill(egui::Color32::from_rgb(80, 55, 120)).stroke(egui::Stroke::new(1.0, p_sb.purple)),
                        );
                        if create_resp.clicked() {
                            self.state.create_group_dialog.open = true;
                            self.state.create_group_dialog.name.clear();
                            self.state.create_group_dialog.selected_members.clear();
                            self.state.create_group_dialog.topic.clear();
                        }
                        ui.add_space(8.0);

                        if groups.is_empty() {
                            ui.vertical_centered(|ui| {
                                ui.add_space(40.0);
                                ui.label(egui::RichText::new("暂无 Group").size(13.0).color(p_sb.text_muted));
                                ui.add_space(6.0);
                                ui.label(egui::RichText::new("点击上方按钮创建").size(11.0).color(p_sb.text_muted));
                            });
                        } else {
                            egui::ScrollArea::vertical().show(ui, |ui| {
                                for g in &groups {
                                    let sel = selected_group.as_deref() == Some(&g.id);

                                    let card_resp = ui.allocate_ui(
                                        egui::vec2(ui.available_width(), 72.0),
                                        |ui| {
                                            let rect = ui.available_rect_before_wrap();
                                            let bg = if sel { p_sb.bg_elevated } else { p_sb.bg_base };
                                            ui.painter().rect_filled(rect, egui::CornerRadius::same(4), bg);

                                            // Left purple bar
                                            ui.painter().rect_filled(
                                                egui::Rect::from_min_max(rect.left_top(), rect.left_bottom() + egui::vec2(3.0, 0.0)),
                                                egui::CornerRadius::default(),
                                                p_sb.purple,
                                            );
                                            if sel {
                                                ui.painter().rect_stroke(
                                                    rect, egui::CornerRadius::same(4),
                                                    egui::Stroke::new(1.0, p_sb.purple),
                                                    egui::StrokeKind::Outside,
                                                );
                                            }

                                            ui.add_space(6.0);
                                            ui.horizontal(|ui| {
                                                ui.add_space(14.0);
                                                ui.vertical(|ui| {
                                                    ui.label(
                                                        egui::RichText::new(&g.name)
                                                            .size(13.0).color(p_sb.purple).strong(),
                                                    );
                                                    ui.label(
                                                        egui::RichText::new(format!("{} 成员 · {}", g.members.len(), g.protocol))
                                                            .size(10.0).color(p_sb.text_sub),
                                                    );
                                                    if let Some(topic) = &g.topic {
                                                        if !topic.is_empty() {
                                                            ui.label(
                                                                egui::RichText::new(format!("Topic: {}", topic))
                                                                    .size(10.0).color(p_sb.text_sub),
                                                            );
                                                        }
                                                    }
                                                    let members_str = g.members.join(", ");
                                                    ui.label(
                                                        egui::RichText::new(members_str)
                                                            .size(9.0).color(p_sb.text_muted),
                                                    );
                                                });
                                            });
                                        },
                                    );

                                    if card_resp.response.clicked() {
                                        self.state.selected_group = Some(g.id.clone());
                                    }
                                    ui.add_space(3.0);
                                }
                            });
                        }
                    }
                }
            });

        // ─── Main Content ──────────────────────────────────────
        let p_main = p.clone();
        let sel_agent_info = selected_agent.as_ref().and_then(|id| {
            agents.iter().find(|a| &a.id == id).cloned()
        });

        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(p.bg_base))
            .show(ctx, |ui| {
                // Agent header
                if let Some(info) = &sel_agent_info {
                    let header_rect = ui.available_rect_before_wrap();
                    ui.painter().rect_filled(
                        egui::Rect::from_min_max(header_rect.left_top(), header_rect.right_top() + egui::vec2(0.0, 48.0)),
                        egui::CornerRadius::default(),
                        p_main.bg_surface,
                    );
                    ui.horizontal(|ui| {
                        ui.add_space(16.0);
                        ui.add_space(8.0);
                        // Status dot
                        let status_col = p_main.status_color(&info.status);
                        let cursor = ui.cursor().left_top();
                        let dot_pos = cursor + egui::vec2(4.0, 10.0);
                        ui.painter().circle_filled(dot_pos, 5.0, status_col);
                        ui.add_space(14.0);

                        ui.vertical(|ui| {
                            ui.add_space(4.0);
                            ui.label(egui::RichText::new(&info.name).size(15.0).color(p_main.text).strong());
                            ui.horizontal(|ui| {
                                if !info.role.is_empty() {
                                    ui.label(egui::RichText::new(&info.role).size(10.0).color(p_main.text_sub));
                                    ui.label(egui::RichText::new("·").size(10.0).color(p_main.text_muted));
                                }
                                ui.label(
                                    egui::RichText::new(format!("{} / {}", info.model, info.provider))
                                        .size(10.0).color(p_main.text_muted),
                                );
                                ui.label(egui::RichText::new("·").size(10.0).color(p_main.text_muted));
                                ui.label(egui::RichText::new(&info.status).size(10.0).color(status_col));
                            });
                        });
                    });
                    ui.add_space(4.0);
                    // Separator
                    let sep = ui.available_rect_before_wrap();
                    ui.painter().line_segment(
                        [egui::pos2(sep.left(), sep.top()), egui::pos2(sep.right(), sep.top())],
                        egui::Stroke::new(1.0, p_main.border),
                    );
                    ui.add_space(4.0);
                } else {
                    // Empty state
                    ui.vertical_centered(|ui| {
                        ui.add_space(120.0);
                        ui.label(egui::RichText::new("MyAgents").size(24.0).color(p_main.accent).strong());
                        ui.add_space(12.0);
                        ui.label(egui::RichText::new("选择一个 Agent 开始对话").size(13.0).color(p_main.text_sub));
                        ui.add_space(6.0);
                        ui.label(egui::RichText::new("或创建一个新的 Agent").size(11.0).color(p_main.text_muted));
                    });
                }

                // Messages
                egui::ScrollArea::vertical()
                    .stick_to_bottom(true)
                    .show(ui, |ui| {
                        for m in &messages {
                            render_message(ui, &p_main, m);
                            ui.add_space(4.0);
                        }
                        if waiting {
                            render_thinking(ui, &p_main, &stream_buffer);
                        }
                    });
            });

        // ─── Create Agent Dialog ───────────────────────────────
        let mut agent_cmd_to_send: Option<String> = None;
        let mut agent_dialog_close = false;
        let pc1 = p.clone();
        if self.state.create_agent_dialog.open {
            let dialog = &mut self.state.create_agent_dialog;
            egui::Window::new(egui::RichText::new("创建 Agent").strong())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .fixed_size([440.0, 380.0])
                .frame(egui::Frame::NONE
                    .fill(pc1.bg_surface)
                    .stroke(egui::Stroke::new(1.0, pc1.border))
                    .corner_radius(egui::CornerRadius::same(8))
                    .inner_margin(egui::Margin::same(20)))
                .show(ctx, |ui| {
                    ui.add_space(4.0);

                    ui.label(egui::RichText::new("名称").size(11.0).color(pc1.text_sub));
                    ui.add(egui::TextEdit::singleline(&mut dialog.name).desired_width(f32::INFINITY));
                    ui.add_space(4.0);

                    ui.label(egui::RichText::new("角色").size(11.0).color(pc1.text_sub));
                    ui.add(egui::TextEdit::singleline(&mut dialog.role).desired_width(f32::INFINITY));
                    ui.add_space(4.0);

                    ui.horizontal(|ui| {
                        ui.vertical(|ui| {
                            ui.label(egui::RichText::new("Provider").size(11.0).color(pc1.text_sub));
                            ui.add(egui::TextEdit::singleline(&mut dialog.provider).desired_width(180.0));
                        });
                        ui.add_space(8.0);
                        ui.vertical(|ui| {
                            ui.label(egui::RichText::new("Model").size(11.0).color(pc1.text_sub));
                            ui.add(egui::TextEdit::singleline(&mut dialog.model).desired_width(180.0));
                        });
                    });
                    ui.add_space(4.0);

                    ui.label(egui::RichText::new("System Prompt (可选)").size(11.0).color(pc1.text_sub));
                    ui.add(egui::TextEdit::multiline(&mut dialog.system_prompt)
                        .desired_rows(3)
                        .desired_width(f32::INFINITY));
                    ui.add_space(16.0);

                    ui.horizontal(|ui| {
                        let can_create = !dialog.name.is_empty() && !dialog.role.is_empty();
                        let create_btn = ui.add_sized(
                            [110.0, 32.0],
                            egui::Button::new(
                                egui::RichText::new("创建").size(12.0).color(egui::Color32::WHITE).strong(),
                            ).fill(if can_create { pc1.accent } else { pc1.border })
                             .stroke(egui::Stroke::NONE),
                        );
                        if create_btn.clicked() && can_create {
                            let cmd = format!(
                                "创建一个Agent：名字是{}，角色是{}，使用{}的{}模型{}",
                                dialog.name, dialog.role, dialog.provider, dialog.model,
                                if dialog.system_prompt.is_empty() { String::new() }
                                else { format!("，系统提示词：{}", dialog.system_prompt) },
                            );
                            agent_cmd_to_send = Some(cmd);
                            agent_dialog_close = true;
                        }
                        ui.add_space(8.0);
                        let cancel_btn = ui.add_sized(
                            [80.0, 32.0],
                            egui::Button::new(
                                egui::RichText::new("取消").size(12.0).color(pc1.text_sub),
                            ).fill(pc1.bg_elevated).stroke(egui::Stroke::new(1.0, pc1.border)),
                        );
                        if cancel_btn.clicked() {
                            agent_dialog_close = true;
                        }
                    });
                });

            if agent_dialog_close {
                self.state.create_agent_dialog.open = false;
            }
            if let Some(cmd) = agent_cmd_to_send {
                let msg = serde_json::json!({
                    "type": "send_message",
                    "payload": { "agentId": "butler", "content": cmd }
                });
                let sender = self.backend.sender();
                let _ = sender.send(backend::FrontendMsg::Send(msg.to_string()));
                self.state.start_waiting();
            }
        }

        // ─── Create Group Dialog ───────────────────────────────
        let mut group_cmd_to_send: Option<String> = None;
        let mut group_dialog_close = false;
        let pc2 = p.clone();
        if self.state.create_group_dialog.open {
            let dialog = &mut self.state.create_group_dialog;
            egui::Window::new(egui::RichText::new("创建 Group").strong())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .fixed_size([480.0, 520.0])
                .frame(egui::Frame::NONE
                    .fill(pc2.bg_surface)
                    .stroke(egui::Stroke::new(1.0, pc2.border))
                    .corner_radius(egui::CornerRadius::same(8))
                    .inner_margin(egui::Margin::same(20)))
                .show(ctx, |ui| {
                    ui.add_space(4.0);

                    ui.label(egui::RichText::new("群组名称").size(11.0).color(pc2.text_sub));
                    ui.add(egui::TextEdit::singleline(&mut dialog.name).desired_width(f32::INFINITY));
                    ui.add_space(8.0);

                    ui.label(egui::RichText::new("选择成员").size(11.0).color(pc2.text_sub));
                    ui.add_space(4.0);

                    if available_agents.is_empty() {
                        ui.vertical_centered(|ui| {
                            ui.add_space(16.0);
                            ui.label(egui::RichText::new("暂无 Agent，请先创建").size(11.0).color(pc2.text_muted));
                        });
                    } else {
                        egui::ScrollArea::vertical()
                            .max_height(220.0)
                            .show(ui, |ui| {
                                for agent in &available_agents {
                                    let is_selected = dialog.selected_members.contains(&agent.id);
                                    let bg = if is_selected {
                                        pc2.purple.linear_multiply(0.2)
                                    } else {
                                        pc2.bg_base
                                    };
                                    let border_col = if is_selected { pc2.purple } else { pc2.border };

                                    let card_resp = ui.allocate_ui(
                                        egui::vec2(ui.available_width(), 40.0),
                                        |ui| {
                                            let rect = ui.available_rect_before_wrap();
                                            ui.painter().rect_filled(rect, egui::CornerRadius::same(4), bg);
                                            ui.painter().rect_stroke(
                                                rect, egui::CornerRadius::same(4),
                                                egui::Stroke::new(1.0, border_col),
                                                egui::StrokeKind::Outside,
                                            );

                                            ui.add_space(6.0);
                                            ui.horizontal(|ui| {
                                                ui.add_space(10.0);
                                                let check = if is_selected { "●" } else { "○" };
                                                let check_col = if is_selected { pc2.purple } else { pc2.text_muted };
                                                ui.label(egui::RichText::new(check).size(12.0).color(check_col));
                                                ui.add_space(8.0);
                                                ui.vertical(|ui| {
                                                    ui.add_space(2.0);
                                                    ui.label(
                                                        egui::RichText::new(&agent.name)
                                                            .size(12.0).color(pc2.text).strong(),
                                                    );
                                                    ui.label(
                                                        egui::RichText::new(format!("{} · {}", agent.model, agent.provider))
                                                            .size(9.0).color(pc2.text_muted),
                                                    );
                                                });
                                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                                    ui.add_space(8.0);
                                                    let sc = pc2.status_color(&agent.status);
                                                    let cursor = ui.cursor().left_top();
                                                    ui.painter().circle_filled(cursor + egui::vec2(4.0, 6.0), 3.0, sc);
                                                    ui.add_space(14.0);
                                                });
                                            });
                                        },
                                    );

                                    if card_resp.response.clicked() {
                                        if is_selected {
                                            dialog.selected_members.retain(|id| id != &agent.id);
                                        } else {
                                            dialog.selected_members.push(agent.id.clone());
                                        }
                                    }
                                    ui.add_space(2.0);
                                }
                            });
                    }

                    // Selected members preview
                    if !dialog.selected_members.is_empty() {
                        let members_snapshot: Vec<String> = dialog.selected_members.clone();
                        ui.add_space(6.0);
                        ui.horizontal_wrapped(|ui| {
                            ui.label(egui::RichText::new("已选: ").size(10.0).color(pc2.text_sub));
                            for member_id in &members_snapshot {
                                let name = available_agents.iter()
                                    .find(|a| &a.id == member_id)
                                    .map(|a| a.name.as_str())
                                    .unwrap_or(member_id.as_str());
                                ui.label(
                                    egui::RichText::new(format!("{} ", name))
                                        .size(10.0).color(pc2.purple),
                                );
                            }
                        });
                    }

                    ui.add_space(6.0);
                    ui.label(egui::RichText::new("讨论主题 (可选)").size(11.0).color(pc2.text_sub));
                    ui.add(egui::TextEdit::singleline(&mut dialog.topic).desired_width(f32::INFINITY));
                    ui.add_space(16.0);

                    ui.horizontal(|ui| {
                        let can_create = !dialog.name.is_empty() && !dialog.selected_members.is_empty();
                        let create_btn = ui.add_sized(
                            [110.0, 32.0],
                            egui::Button::new(
                                egui::RichText::new("创建").size(12.0).color(egui::Color32::WHITE).strong(),
                            ).fill(if can_create { pc2.purple.linear_multiply(0.7) } else { pc2.border })
                             .stroke(egui::Stroke::NONE),
                        );
                        if create_btn.clicked() && can_create {
                            let members_str = dialog.selected_members.join("、");
                            let cmd = format!(
                                "创建一个群组：名字是{}，成员是{}{}",
                                dialog.name, members_str,
                                if dialog.topic.is_empty() { String::new() }
                                else { format!("，讨论主题：{}", dialog.topic) },
                            );
                            group_cmd_to_send = Some(cmd);
                            group_dialog_close = true;
                        }
                        ui.add_space(8.0);
                        let cancel_btn = ui.add_sized(
                            [80.0, 32.0],
                            egui::Button::new(
                                egui::RichText::new("取消").size(12.0).color(pc2.text_sub),
                            ).fill(pc2.bg_elevated).stroke(egui::Stroke::new(1.0, pc2.border)),
                        );
                        if cancel_btn.clicked() {
                            group_dialog_close = true;
                        }
                    });
                });

            if group_dialog_close {
                self.state.create_group_dialog.open = false;
            }
            if let Some(cmd) = group_cmd_to_send {
                let msg = serde_json::json!({
                    "type": "send_message",
                    "payload": { "agentId": "butler", "content": cmd }
                });
                let sender = self.backend.sender();
                let _ = sender.send(backend::FrontendMsg::Send(msg.to_string()));
                self.state.start_waiting();
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Message rendering
// ═══════════════════════════════════════════════════════════════

fn render_message(ui: &mut egui::Ui, p: &Palette, m: &views::LogMessage) {
    let (bg, label_col, label, align_right) = match m.direction.as_str() {
        "in" => (p.user_bg, p.user_accent, "You", true),
        "out" => (p.asst_bg, p.asst_accent, "Assistant", false),
        _ => (p.sys_bg, p.sys_accent, "System", false),
    };

    let max_width = (ui.available_width() * 0.72).max(200.0);

    ui.allocate_ui_with_layout(
        ui.available_size(),
        egui::Layout::top_down(if align_right { egui::Align::Max } else { egui::Align::Min }),
        |ui| {
            ui.add_space(2.0);
            ui.horizontal(|ui| {
                if align_right { ui.add_space(ui.available_width() - max_width); }
                ui.add_space(if align_right { 0.0 } else { 4.0 });

                egui::Frame::NONE
                    .fill(bg)
                    .corner_radius(egui::CornerRadius::same(8))
                    .inner_margin(egui::Margin::same(12))
                    .stroke(egui::Stroke::new(1.0, bg.linear_multiply(1.4)))
                    .show(ui, |ui| {
                        ui.set_max_width(max_width);
                        // Header: label + timestamp
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new(label).size(10.0).color(label_col).strong());
                            ui.add_space(8.0);
                            ui.label(egui::RichText::new(m.timestamp_short()).size(9.0).color(p.text_muted));
                        });
                        ui.add_space(4.0);
                        ui.label(egui::RichText::new(&m.content).size(13.0).color(p.text));
                    });

                if !align_right { ui.add_space(ui.available_width() - max_width); }
            });
        },
    );
}

// ═══════════════════════════════════════════════════════════════
// Thinking / streaming indicator
// ═══════════════════════════════════════════════════════════════

fn render_thinking(ui: &mut egui::Ui, p: &Palette, stream_buffer: &str) {
    let time = ui.input(|i| i.time);

    // Pulsing dot
    let pulse = ((time * 3.0).sin() * 0.5 + 0.5) as f32;
    let dot_alpha = (100.0 + 155.0 * pulse) as u8;
    let dot_color = egui::Color32::from_rgba_premultiplied(
        p.asst_accent.r(), p.asst_accent.g(), p.asst_accent.b(), dot_alpha,
    );

    let content = if stream_buffer.is_empty() { "Thinking..." } else { stream_buffer };
    let label = if stream_buffer.is_empty() { "Assistant" } else { "Assistant (streaming)" };

    ui.add_space(2.0);
    egui::Frame::NONE
        .fill(p.asst_bg)
        .corner_radius(egui::CornerRadius::same(8))
        .inner_margin(egui::Margin::same(12))
        .stroke(egui::Stroke::new(1.0, p.asst_bg.linear_multiply(1.4)))
        .show(ui, |ui| {
            ui.set_max_width(ui.available_width() * 0.72);
            ui.horizontal(|ui| {
                let cursor = ui.cursor().left_top();
                ui.painter().circle_filled(cursor + egui::vec2(5.0, 8.0), 4.0, dot_color);
                ui.add_space(14.0);
                ui.label(egui::RichText::new(label).size(10.0).color(p.asst_accent).strong());
            });
            ui.add_space(4.0);
            ui.label(egui::RichText::new(content).size(13.0).color(p.text));
        });
}
