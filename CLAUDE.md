# D:\agent-codes 工作区指令

## 当前项目

正在开发 **CoBeing**（多 Agent 协作框架）。

启动会话时，**必须先阅读** `CoBeing/CLAUDE.md` 获取项目级指令和执行规则。同时阅读 `GOAL.md` 了解项目愿景和设计目标。

## 工作区目录结构

```
D:\agent-codes\
├── CLAUDE.md              # 本文件 — 工作区入口指令
├── GOAL.md                # CoBeing 项目愿景
├── README.md              # CoBeing 项目说明
├── STRUCTURE.md           # CoBeing 项目结构文档
├── PROGRESS.md            # 详细开发进度
├── PROGRESS-LITE.md       # 精简进度（标签化）
├── PROGRESS-VERSION.md    # 版本发布记录
├── .claude/               # Claude 配置与 skills
├── .superpowers/           # Superpowers 配置
│
├── CoBeing/               # 主项目（多 Agent 协作框架）
│   ├── CLAUDE.md          #   项目级指令（唯一保留在项目内的文档）
│   ├── packages/          #   pnpm monorepo 后端
│   ├── gui-v2/            #   前端 GUI
│   ├── config/            #   项目配置
│   ├── data/              #   运行时数据（7 分类）
│   ├── sandbox/           #   沙箱 Docker 镜像
│   └── scripts/           #   开发脚本
│
├── docs/                  # 项目文档
│   ├── 调研/              #   竞品调研笔记（含真人说话模拟调研）
│   ├── 项目信息/          #   当前核心项目文档
│   │   ├── 产品战略.md    #   产品定位、管家入口、Market 分层与战略共识
│   │   ├── 核心技术.md    #   三层智能体、TODOboard、群组驱动协作技术主张
│   │   ├── 项目现状.md    #   按代码事实描述当前实现与边界
│   │   ├── 架构说明.md    #   后端/前端/Agent/Group/扩展架构
│   │   ├── 使用说明.md    #   当前用户与进阶用户使用路径
│   │   ├── 当前待办.md    #   当前仍有效的待办
│   │   └── 非Market未实现项审查.md #   大版本更新非 Market 未实现项代码审查
│   ├── superpowers/       #   实现计划与设计规格
│   ├── GOALS/             #   项目目标文档
│   ├── log/               #   日志目录
│   ├── roadmap/           #   路线图文档
│   └── archive/           #   历史归档（含旧进度归档）
│
├── projects/              # 其他独立项目
│   ├── Auto-claude-code-research-in-sleep/  #   自动化论文研究
│   ├── SAI-claw/          #   SAI Claw 项目
│   ├── claw-code/         #   Rust CLI agent 框架
│   ├── openclaw/          #   多渠道 AI 网关
│   ├── hermes/            #   Hermes agent
│   └── sillytavern/       #   SillyTavern 文档
│
├── releases/              # 发布产物归档
│   ├── CoBeing-github/    #   GitHub 发布版（独立 git）
│   ├── CoBeing-v1.1.zip
│   ├── CoBeing-v1.1.1.zip
│   ├── CoBeing-v1.2.0.zip
│   ├── CoBeing-v1.3.1.zip
│   └── release-body.json
│
├── resourses/             # 资源文件（图片、海报）
│
├── roadshow/              # 路演材料
    ├── index.html         #   演示页
    ├── main-icon.png
    ├── 路演PPT设计.md
    ├── 路演讲稿.md
    ├── 刘诚roadshow.zip
    └── 玄武区创新大赛/    #   创新大赛材料
│
└── 备份/                  # 历史备份
```

## 目录结构更新规则

**每次新增、删除、重命名根目录或 `projects/`、`releases/`、`docs/`、`roadshow/` 下的文件/目录时，必须同步更新本文件中的目录结构树。** 保持文档与实际文件系统一致。

## 每次修复/变更的文档同步规则

**每次对项目代码进行修复、重构或功能变更后，必须同步更新以下文档：**

1. **`PROGRESS.md`** — 在文件顶部追加详细变更条目，包含：日期、问题描述、根因（若为修复）、修改文件列表、修改内容摘要
2. **`PROGRESS-LITE.md`** — 同步追加精简条目（`[New Feature]` / `[Debug]` / `[Change]` + 一句话描述）
3. **`docs/项目信息/` 中相关文档**（产品战略、核心技术、项目现状、架构说明、使用说明、当前待办）— 必须与代码实际状态一致，不得有幻觉内容
4. **`STRUCTURE.md`** — 如果新增/删除/重命名文件或目录，必须同步更新目录结构树

此规则适用于所有根据调研报告、审计、文档分析等发起的修复工作。
