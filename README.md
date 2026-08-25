# CoBeing 2.0

> 本地优先的多智能体协作框架 —— 让 AI Agent 组队为你干活

CoBeing 是一个原生多 Agent 协作平台。管家（Butler）负责组织，工作智能体（Agent）负责干活，群组（Group）是多人协作空间：你说一句话，团队把事做完。

**2.0.0 为全新架构重写**（与根目录 v1 平行隔离）：从零设计的原体循环、事件日志、工具调度与经验机制，参考 dsh（DeepSeek Harness）工程机制打磨——任务锚点跨轮保留、回合终止结构性、发言真实性审查、未完成自动续轮。

---

## 下载与安装

| 平台 | 安装包 | 说明 |
|---|---|---|
| **Windows 桌面** | `CoBeing v2_2.0.0_x64-setup.exe`（GitHub Release） | 双击安装即用，无需安装 Node.js（内核已内置） |
| **Android 手机** | `CoBeing-mobile-v2.0.0-debug.apk`（GitHub Release） | 连接电脑上的内核远程使用 |

> Release 页面：https://github.com/CH3SH-LC/CoBeing/releases

### 第一步：配置 DeepSeek API Key

桌面版内核通过 `DEEPSEEK_API_KEY` 环境变量读取密钥：

1. 打开「系统设置 → 高级系统设置 → 环境变量」
2. 新建用户变量：变量名 `DEEPSEEK_API_KEY`，变量值粘贴你的 DeepSeek API Key（https://platform.deepseek.com/ 获取）
3. 重新启动 CoBeing 桌面版

> 未配置 Key 时内核以 mock 模式运行（可用于界面体验，但智能体不会真实工作）。

### 第二步：开始使用

1. **主窗口对话**：与管家但丁对话，安排任务
2. **创建智能体**：「智能体」页提交创建请求并批准（如 game-dev / writer）
3. **新建群组**：「群组」页创建（user + butler + 至少 1 个工作智能体），在群里发言下发任务
   - 不选 @ 成员时发言将唤醒全部工作智能体；指名 @成员 只唤醒对应智能体
   - 建议填写「任务说明」——任务目标每轮都在场，智能体不会失忆
4. **验收与归档**：任务完成后在群里确认，可归档群组（成员经验自动沉淀，下次同类任务复用）

### 手机端

1. 电脑上双击 `start-remote.bat`：选 1 局域网 / 2 外网隧道（cloudflared），屏幕打印地址 + Token
2. 手机安装 APK，打开「设置」页填入地址与 Token 连接
3. 支持：对话、群组实时同步、智能体与记忆面板、远程控制（截屏/媒体键/电源/剪贴板/文件）

---

## 核心特性

- **管家但丁**：唯一人格化入口，主窗口与群组双实例；群组感知（list-groups / create-group / ask-user 确认卡片）
- **原体循环**：任务锚点保留 + 工具结果回填 + 输出协议结构化（dsh 对齐）——智能体不会"只说不做"
- **【诚实】发言真实性审查**：群组发言声称完成必须匹配真实工具证据，"只说不做"被拦截并引导继续；过程性进展发布后自动续轮直到完成
- **经验记忆**：【记忆】工具智能体统一总结（自适范围 / 画像合并 / 轮次节流），跨任务沉淀
- **事件日志**：append-only JSONL，重启恢复 working 群组，归档保留历史
- **工具面**：str-replace-editor（写文件/精确编辑/fs 观察校验）、persistent-bash（真实持久 PowerShell）、glob/grep、todo-list、group-speak
- **实时同步**：桌面/手机双端 update 广播，无需轮询

---

## 项目结构

```
CoBeing-v2/
├── packages/
│   ├── types/      # 事件模型 / 实体 / 工具契约
│   ├── core/       # 内核：插件框架 / 事件日志 / 调度器 / 原体循环 / 群组 / 管家 / 经验 / 工具
│   └── bridge/     # JSON-RPC 桥 + CLI（cobeing-kernel）+ WS 远程服务器
├── gui/            # Tauri 2 桌面端（React 19 + Rust 内核桥）
├── mobile/         # 手机端（Capacitor 6 + React 19，独立工程）
├── scripts/        # 冒烟 / 真实验证脚本（verify-*）
└── docs/           # 设计文档（纯HI 为只读权威源）+ 使用指南
```

---

## 开发与构建

```bash
# 依赖安装（仓库根）
pnpm install

# 单元测试（core + bridge）
pnpm --filter @cobeing/core test

# 桌面开发模式（GUI 自动拉起内核）
cd gui && pnpm tauri dev

# 桌面发布打包（含内核打包：node.exe + kernel.mjs 资源）
node scripts/build-kernel-dist.mjs
cd gui && pnpm tauri build

# 手机 APK
powershell -File scripts/build-apk.ps1
```

> 详细设计文档见 `CoBeing-v2/docs/`；真实验证脚本 `CoBeing-v2/scripts/verify-*.mjs`（真实 DeepSeek 端到端）。

---

## 旧版 v1

仓库根目录保留 v1 代码与文档（`README_CN.md`、`docs/项目信息/` 等）。v1 为 1.4.0 单体架构，已停止演进；2.0 为全新重写，两者物理隔离。

---

## 许可

MIT（详见 LICENSE）
