# MyAgents 开发进度

## Phase 8: 架构重构

### Phase 8.1: Agent 自治文件系统 + 配置重设计 ✅
- [x] Task 1: AgentPaths 扩展 (USER/BOOTSTRAP/TOOLS 路径)
- [x] Task 2: AgentFiles 新增读写方法 + consumeBootstrap
- [x] Task 3: buildSystemPromptFromFiles 文件链构建
- [x] Task 4: Agent 使用新 prompt builder
- [x] Task 5: 配置 Schema 重设计 (AgentSelfConfig)
- [x] Task 6: Config Loader 支持 JSON + default.json
- [x] Task 7: 模板文件 (config/templates/) + butler 默认配置
- [x] Task 8: Runtime 从自治配置恢复 Agent
- [x] Task 9: Butler 创建 Agent 时写入自治文件 + 模板
- [x] Task 10: 集成测试 + PROGRESS.md

### Phase 8.2: Skill 仓库架构 ✅ (2026-04-19)
- [x] Task 1: 创建 SkillRepository (统一 skills/ 目录，SKILL.md 格式)
- [x] Task 2: 创建 skill 统一工具 (skill-execute / skill-list / skill-create)
- [x] Task 3: Agent 使用 SkillRepository (injectSkillRepository + 3 工具)
- [x] Task 4: Runtime/Butler 适配 (全局 SkillRepository 注入)
- [x] Task 5: 测试 + PROGRESS.md (152/152 通过)

**关键变化:**
- 旧: Agent 构造时加载 YAML/JSON + 私有 SKILL.md → 注册 skill-xxx 工具
- 新: Runtime 创建全局 SkillRepository → Agent.injectSkillRepository() → 注册 skill-execute/list/create
- 白名单过滤: config.json 的 skills 字段控制可用技能

### Phase 8.3: 异步协作引擎 (待开始)
### Phase 8.4: 经验系统修复 (待开始)
### Phase 8.5: 群主管理 Skill (待开始)
