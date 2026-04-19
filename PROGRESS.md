# MyAgents 开发进度

## Phase 8: 架构重构

### Phase 8.1: Agent 自治文件系统 + 配置重设计 ✅
- [x] 10 tasks completed

### Phase 8.2: Skill 仓库架构 ✅
- [x] 5 tasks completed

### Phase 8.3: 异步协作引擎 ✅ (2026-04-19)
- [x] Task 1: GroupContextV2 (tag-based 统一消息数组 + 上下文过滤)
- [x] Task 2: WakeSystem (事件驱动唤醒队列 + @mention 处理)
- [x] Task 3: Screener (群主双模型初筛)
- [x] Task 4: Group 重构 (v2 上下文 + WakeSystem + Talk 机制)
- [x] Task 5: 移除 GroupProtocol (讨论不再由固定协议控制)
- [x] Task 6: Runtime/Butler/group-tools 适配新架构
- [x] Task 7: 修复全部测试 (152/152 通过)

**关键变化:**
- 旧: 同步 for 循环讨论 + GroupProtocol + GroupContext
- 新: 事件驱动 WakeSystem + tag-based GroupContextV2 + Screener 双模型
- Group 不再有 protocol 字段（改为可选，兼容旧配置）
- ChannelRouter + group-tools 全部适配 v2

### Phase 8.4: 经验系统修复 (待开始)
### Phase 8.5: 群主管理 Skill (待开始)
