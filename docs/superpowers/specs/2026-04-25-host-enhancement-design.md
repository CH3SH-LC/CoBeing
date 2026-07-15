# HostAgent 增强 + 本地模型过滤层设计

> 日期: 2026-04-25 | 状态: 已批准

---

## 目标

1. 大幅增强群主（HostAgent）的沟通协作能力
2. 群主与群聊 TODO 板深度联动，管理 TODO 全流程
3. 引入本地小模型（Qwen 3.5 2B）作为群主的过滤层
4. 为群主创建专属文件夹（类似 butler 的 data/butler/）

---

## 整体架构

```
群组消息到达
  │
  ▼
WakeSystem.handleNewMessage()
  │
  ├─ 1. @mention 路径（现有逻辑不变）
  │     → 直接唤醒被 @mention 的 Agent
  │
  └─ 2. 本地过滤路径（新增）
        → LocalFilterEngine (node-llama-cpp, Qwen 3.5 2B GGUF)
        → 结构化输出: { shouldWake, reason, summary, priority }
        → 如果 shouldWake=true → 唤醒 HostAgent，附带本地模型的分析摘要
        → HostAgent 基于摘要 + 群组上下文做出决策
```

**核心原则**：
- 本地模型**只做判断**（是否建议唤醒群主），不做生成
- 本地模型的产物**只有群主能看到**，不暴露给其他成员
- 现有 @mention 机制完全保留，本地过滤是**新增的并行路径**
- HostAgent 自己发的消息不触发过滤（防循环）
- 过滤层是**纯优化**，不是功能依赖——最差情况退化为"总是唤醒"

---

## 目录结构

```
data/
├── host/                   # 群主专属文件夹（类似 butler）
│   ├── config.json         # 群主自治配置（provider/model/tools/sandbox）
│   ├── GROUPS_REGISTRY.md  # 管理的群组列表和状态
│   ├── DECISIONS.md        # 决策记录（跨群组）
│   ├── SOUL.md             # 群主性格特质
│   ├── CHARACTER.md        # 群主人物描写
│   ├── JOB.md              # 群主职责定义
│   ├── AGENTS.md           # 工作空间指南
│   └── EXPERIENCE.md       # 群主积累的协作经验
├── models/
│   └── qwen3.5-2b/         # 模型文件（从 data/host/ 迁移）
│       ├── model.gguf      # GGUF 格式权重
│       └── ...
├── groups/                 # 群组数据（现有）
│   └── {groupId}/
│       ├── config.json
│       ├── TODO.json       # 群组级 TODO
│       └── ...
```

---

## LocalFilterEngine — 本地过滤引擎

**文件位置**：`packages/core/src/group/local-filter.ts`

### 接口定义

```typescript
interface FilterResult {
  shouldWake: boolean;       // 是否建议唤醒群主
  reason: string;            // 原因（一句话）
  summary?: string;          // 上下文摘要（供群主参考）
  priority: "high" | "normal" | "low";
}

interface LocalFilterEngine {
  init(modelPath: string): Promise<void>;
  evaluate(groupId: string, messages: GroupMessageV2[]): Promise<FilterResult>;
  dispose(): void;
}
```

### 调用时机

WakeSystem 收到新消息后，如果消息**同时满足**以下条件 → 调用 `evaluate()`：
- 不是 @mention 群主（@mention 路径已处理）
- 发送者不是群主自己（防循环）
- 本地过滤引擎已初始化且可用

### Prompt 策略

- 固定 system prompt（硬编码），告诉模型："你是群组协调助手，分析以下群聊消息，判断是否需要群主介入"
- 输入：最近 N 条群消息（截断到模型上下文窗口）
- 输出：强制 JSON 格式 `{ shouldWake, reason, summary, priority }`
- 用 node-llama-cpp 的 `grammar` 功能强制 JSON 输出格式

### 判断准则

- **不确定时一律选 shouldWake: true**（宁可多叫不漏叫）
- 判断维度：是否有新问题、是否有分歧、是否需要决策、是否有人求助、是否有进展需要确认
- 明确不需要群主的情况：成员之间的简单回复、闲聊、已明确的执行中任务

### 性能考量

- 2B 模型推理快（~50-200ms），不会阻塞群消息流
- 模型常驻内存，不每次加载
- 消息累积批处理：短时间内多条消息合并成一次评估（debounce）

### 降级策略

- 模型加载失败 → 本地过滤禁用，退化为"总是唤醒"模式
- 推理超时（>2s） → 跳过过滤，不唤醒
- 模型质量差 → 只是多唤醒几次群主，功能正确

---

## WakeSystem 改造

### 新增过滤路径

```typescript
class WakeSystem {
  private localFilter?: LocalFilterEngine;
  private ownerId?: string;

  private handleNewMessage(msg: GroupMessageV2): void {
    // 1. 现有逻辑：扫描 @mentions → 加入唤醒队列
    for (const targetId of msg.mentions) {
      this.wakeQueue.push({ targetAgentId: targetId, ... });
    }

    // 2. 新增：本地过滤判断是否唤醒群主
    if (this.localFilter && msg.fromAgentId !== this.ownerId) {
      this.evaluateForOwner(msg);  // 异步，不阻塞
    }

    this.processQueue();
  }

  private async evaluateForOwner(msg: GroupMessageV2): Promise<void> {
    const recent = this.ctx.getMessages().slice(-20);
    const result = await this.localFilter!.evaluate(this.ctx.groupId, recent);
    if (result.shouldWake) {
      this.wakeOwnerWithFilterResult(result);
    }
  }
}
```

### 关键设计决策

- 本地过滤**异步执行**，不阻塞消息流
- 过滤结果注入为群主的**私有上下文**（不写入群组消息流）
- 群主自己的消息跳过过滤
- 过滤层和 @mention 是**两条独立路径**，互不干扰

---

## HostAgent 增强

### 新增工具

| 工具名 | 职责 |
|--------|------|
| `host-guide-discussion` | 主动发起/引导讨论：设定议题、@mention 相关成员、给出讨论框架 |
| `host-decompose-task` | 拆解任务为子任务，自动创建 TODO 并分配给成员 |
| `host-summarize-progress` | 总结讨论进展，写入群组工作区 PROGRESS.md |
| `host-record-decision` | 记录决策到群主 DECISIONS.md + 群组工作区 |
| `host-manage-todo` | TODO 增删改查 + 分配 + 跟踪完成（统一入口） |
| `host-review-todo` | 检查到期/逾期 TODO，决定是否催促或重新分配 |

### TODO 全流程联动

```
群主收到过滤层摘要
  → host-decompose-task: 拆解任务，创建多个 TODO
    → 每个 TODO 带 targetAgentId（指定执行人）
    → TODO 触发时由 GroupTodoScanner 唤醒目标成员
  → host-review-todo: 定期检查 TODO 状态
    → 逾期 → 群主发消息催促或重新分配
    → 完成 → host-summarize-progress 更新进展
```

### 群主 System Prompt 增强

- 默认 SOUL 增加"主动引导、不等不靠"特质
- 增加协作行为准则：每轮对话后检查 TODO 状态、适时总结、主动推进
- 本地过滤层的摘要作为上下文的一部分注入

---

## 配置变更

### config/default.json 新增

```json
{
  "core": {
    "localModel": {
      "enabled": true,
      "path": "./data/models/qwen3.5-2b",
      "contextSize": 8192,
      "filterDebounceMs": 3000
    }
  }
}
```

### data/host/config.json（群主自治配置）

```json
{
  "name": "群主",
  "role": "项目协调者和讨论引导者",
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "permissions": { "mode": "full-access" },
  "sandbox": { "enabled": false, "filesystem": "isolated", "network": { "enabled": true, "mode": "all" } },
  "tools": [
    "bash", "read-file", "write-file", "glob", "grep",
    "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
    "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
    "host-record-decision", "host-manage-todo", "host-review-todo",
    "todo-add", "todo-list", "todo-complete", "todo-remove"
  ]
}
```

---

## 依赖项

- `node-llama-cpp` — 新增 npm 依赖
- GGUF 格式模型文件 — 需从 safetensors 转换（提供 `scripts/convert-to-gguf.sh`）
- 现有代码零破坏性改动：所有新功能通过可选配置启用

---

## 实施顺序

1. **LocalFilterEngine 核心实现** — node-llama-cpp 集成 + GGUF 加载 + JSON grammar
2. **WakeSystem 改造** — 过滤路径接入 + owner 身份判断
3. **HostAgent 专属工具** — host-guide-discussion, host-decompose-task 等 6 个工具
4. **HostAgent data/host/ 目录** — 启动流程 + ensureDirs + config 加载
5. **Runtime 集成** — localModel 初始化 + HostAgent 注册改造
6. **前端** — 群主面板增强 + 过滤状态展示
7. **测试** — 单元测试 + 降级策略验证

---

## 不做的事（YAGNI）

- 不做多模型切换（只支持一个本地模型）
- 不做过滤层的动态训练/微调
- 不做跨群组的过滤层共享
- 不做过滤层的可视化配置界面（用 config.json 即可）
- 不做本地模型生成回复（只做判断）
