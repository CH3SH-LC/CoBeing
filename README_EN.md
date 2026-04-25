<p align="center">
  <img src="main-icon.png" alt="CoBeing Logo" width="128" height="128">
</p>

<h1 align="center">CoBeing</h1>

<p align="center">
  <strong>Native Multi-Agent Collaboration Framework</strong>
</p>

<p align="center">
  <a href="README.md">中文</a>
</p>

<p align="center">
  <img src="cobeing-poster.png" alt="CoBeing Poster" width="100%">
</p>

---

## Core Features

### Native Multi-Agent Architecture

CoBeing is not a wrapper around a single AI, but a **natively designed multi-agent collaboration system**. Each Agent is an independent entity with its own memory, experience, and personality.

### Butler Agent & Host Agent

- **Butler**: The user's first point of contact, responsible for understanding needs, creating Agents, and organizing groups
- **Host**: The group's moderator and coordinator, guiding discussions, assigning tasks, and driving decisions

### Native Inter-Agent Communication

Agents can **communicate directly** with each other without human mediation. Supports:
- Group discussions: Multiple Agents collaborate in the same group
- Directed messages: Agents can @mention other Agents
- Task relay: Agents can hand off tasks to more suitable Agents

### TODOboard

Built-in **task management system**, supporting:
- Group-level TODOs: Host can create, assign, and track tasks
- Scheduled triggers: TODOs can set due times with automatic reminders
- Status management: Complete lifecycle from pending to completed

### Self-Learning

Agents have **self-evolution capabilities**:
- **EXPERIENCE.md**: Records accumulated work experience
- **MEMORY.md**: Stores important events and decisions
- **Experience reflection**: Agents can proactively review and summarize experiences

---

## Quick Start

### Requirements

- Node.js >= 22
- pnpm >= 10
- Docker (optional, for sandbox features)

### Installation

```bash
# Clone repository
git clone https://github.com/CH3SH-LC/CoBeing.git
cd CoBeing

# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env
# Edit .env file and add your API keys

# Build project
pnpm build

# Start development server
pnpm dev
```

### Configuration

Edit `config/default.json`:

```json
{
  "core": {
    "logLevel": "info",
    "dataDir": "./data",
    "skillsDir": "./skills"
  },
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "baseURL": "https://api.deepseek.com"
    }
  }
}
```

---

## Project Structure

```
CoBeing/
├── packages/
│   ├── shared/          # Shared types and utilities
│   ├── providers/       # LLM Provider implementations
│   ├── channels/        # Channel adapters
│   └── core/            # Core logic
├── gui-v2/              # Tauri desktop application
├── config/              # Configuration files
├── skills/              # Built-in skills
├── prompts/             # Prompt templates
├── sandbox/             # Docker sandbox configuration
└── scripts/             # Development scripts
```

---

## Core Concepts

### Agent

Agent is the core unit of CoBeing. Each Agent has independent:
- **SOUL.md**: Personality traits and behavioral principles
- **CHARACTER.md**: Character description and background
- **JOB.md**: Focus areas and work methods
- **MEMORY.md**: Memory storage
- **EXPERIENCE.md**: Experience accumulation

### Group

Group is a container for multi-Agent collaboration, supporting:
- Multiple collaboration protocols (discussion, division of labor, relay, etc.)
- Task assignment and progress tracking
- Decision recording and knowledge sharing

### Skill

Skill is a reusable workflow methodology, stored in the `skills/` directory:
- Each skill is a directory containing `SKILL.md`
- Supports frontmatter metadata
- Can be dynamically loaded and executed by Agents

### Channel

Channel is the interface for user interaction:
- Currently supports QQBot (via OneBot v11 protocol)
- More channels under development (Discord, WeCom, Feishu, etc.)

---

## Supported LLM Providers

| Provider | Models | Status |
|----------|--------|--------|
| DeepSeek | deepseek-chat, deepseek-v4-flash | ✅ |
| OpenAI | GPT-4, GPT-4o | ✅ |
| Anthropic | Claude 4.5/4.6/4.7 | ✅ |
| Google | Gemini 2.5/3.0 | ✅ |
| Zhipu | GLM-4 | ✅ |
| Qwen | Qwen-3 | ✅ |
| MiniMax | MiniMax-M1 | ✅ |
| Volcengine | Doubao | ✅ |
| Grok | Grok-3 | ✅ |
| Moonshot | Kimi | ✅ |
| SiliconFlow | Multiple models | ✅ |

---

## Development

### Build

```bash
# Build all packages
pnpm build

# Build single package
pnpm --filter @cobeing/core build

# Watch mode
pnpm dev
```

### Test

```bash
# Run all tests
pnpm test

# Run single package tests
pnpm --filter @cobeing/core test

# Watch mode
pnpm test:watch
```

---

## Acknowledgements

### Project Inspiration

- [OpenClaw](https://github.com/openclaw) - Open source AI Agent framework
- [Hermes](https://github.com/hermes-agent) - Terminal Agent framework
- [Claude Code](https://claude.ai/code) - AI programming assistant

### Model Support

- [Zhipu Qingyan](https://open.bigmodel.cn/) - GLM series models
- [Xiaomi MIMO](https://mimo.xiaomi.com/) - MIMO series models

### Individual Contributions

- **Fan Hongjiao** - Project testing and feedback
- **Ma Zhuqi** - Project testing and feedback
- **Cui Xitong** - Project testing and feedback

### Institutional Support

- **Shanghai Jiao Tong University, School of Artificial Intelligence, Geek Center** - Token support

### Special Thanks

- **Brother Dawei** - Project inspiration

---

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details

---

## Contact

- Issue Reports: [GitHub Issues](https://github.com/CH3SH-LC/CoBeing/issues)
- Discussions: [GitHub Discussions](https://github.com/CH3SH-LC/CoBeing/discussions)

---

**CoBeing** - Let multiple AIs work together for you 🚀
