# CoBeing 运行前提与安装指南

## 必需环境

| 软件 | 最低版本 | 用途 | 安装方式 |
|------|----------|------|----------|
| **Node.js** | >= 22 | 运行时 | [nodejs.org](https://nodejs.org) 下载 LTS 版本 |
| **pnpm** | >= 10 | 包管理与脚本运行 | `npm install -g pnpm` |

安装 Node.js 后，打开终端运行：
```bash
npm install -g pnpm
```

## 可选环境

| 软件 | 用途 | 说明 |
|------|------|------|
| Docker | 沙箱功能 | 需要沙箱隔离执行时安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Rust / Cargo | 打包桌面应用 | 需要构建 .exe 安装包时安装，仅用浏览器模式则不需要 |

## 安装步骤

### 1. 解压
将 `CoBeing-v1.3.1.zip` 解压到任意目录。

### 2. 安装依赖
在 CoBeing 目录下打开终端（或双击 `start.bat` 自动完成）：
```bash
pnpm install
```

### 3. 配置 LLM API Key（可选）
程序**不强制要求**预先配置 API Key。你可以在启动后通过设置页面配置，或在 `.env` 文件中按需填写：

```env
# 按需填入你要使用的厂商 API Key
DEEPSEEK_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
QWEN_API_KEY=sk-xxx
MINIMAX_API_KEY=xxx
VOLCENGINE_API_KEY=xxx
MOONSHOT_API_KEY=sk-xxx
MIMO_API_KEY=xxx
```

> 即使不配置任何 Key，GUI 仍可正常打开和浏览。发送第一条消息前配置即可。

### 4. 启动
双击 `start.bat`，选择启动模式：
- **选项 1** — CLI 终端交互模式
- **选项 2** — GUI 桌面/浏览器模式（推荐）
- **选项 3** — 同时启动 CLI + GUI

GUI 模式会先清理上次残留文件，然后启动后端服务，等待就绪后自动打开 Tauri 桌面窗口。如果没有安装 Rust/Cargo，会自动降级为浏览器模式（打开 `http://localhost:1420`）。

## 支持的 LLM 厂商

| 厂商 | 环境变量 | 获取 API Key |
|------|----------|-------------|
| DeepSeek | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) |
| 智谱 GLM | `ZHIPU_API_KEY` | [open.bigmodel.cn](https://open.bigmodel.cn) |
| 通义千问 | `QWEN_API_KEY` | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| MiniMax | `MINIMAX_API_KEY` | [platform.minimaxi.com](https://platform.minimaxi.com) |
| 火山引擎/豆包 | `VOLCENGINE_API_KEY` | [console.volcengine.com](https://console.volcengine.com) |
| Moonshot/Kimi | `MOONSHOT_API_KEY` | [platform.moonshot.cn](https://platform.moonshot.cn) |
| 小米 MiMo | `MIMO_API_KEY` | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) |

## 常见问题

**Q: 启动报错 "pnpm not found"**  
需要先安装 pnpm：`npm install -g pnpm`

**Q: 启动报错 "node not found"**  
需要安装 Node.js 22+：[nodejs.org](https://nodejs.org)

**Q: 没有配置 API Key 能打开吗？**  
能。GUI 界面正常打开，浏览 Agent/群组/设置等页面均不受影响。发送消息前再配置 Provider 即可。

**Q: 如何接入 QQ？**  
设置页 → Channels → 编辑 QQ Bot → 填入 App ID 和 App Secret。需要先在 [QQ 开放平台](https://q.qq.com) 注册 Bot。

**Q: 启动后杀毒软件报毒？**  
后台运行终端可能导致杀毒软件误判。请将 CoBeing 目录添加到杀毒软件白名单中。
