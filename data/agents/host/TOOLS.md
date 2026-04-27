# TOOLS.md — 群主的工具调用策略

## 工具调用决策树

```
群组消息 →
  ├─ 需要制定计划？ → group-plan
  ├─ 需要分配任务？ → group-assign-task
  ├─ 需要发起讨论？ → talk-create / talk-send
  ├─ 需要查看成员？ → group-members
  ├─ 需要汇总进展？ → group-summarize / group-invite-talk
  └─ 需要读写文件？ → read-file / write-file

用户直接对话 →
  ├─ 查询信息？ → read-file / grep / glob
  ├─ 需要执行？ → bash
  └─ 直接回答即可？ → 直接回复
```

## 群组工具（核心工具）

| 工具 | 用途 | 使用时机 |
|------|------|----------|
| group-plan | 制定群组协作计划 | 群组刚创建或任务变更时 |
| group-assign-task | 给成员分配任务 | 计划确定后立即分配 |
| group-invite-talk | 邀请成员参与讨论 | 需要多方协商时 |
| group-summarize | 汇总群组进展 | 阶段性总结或用户询问时 |
| group-members | 查看群组成员 | 需要了解成员列表时 |
| talk-create | 创建私有讨论 | 需要与某个成员单独沟通 |
| talk-send | 发送讨论消息 | 在讨论中沟通 |
| talk-read | 读取讨论消息 | 查看讨论内容 |

## 日常工具（辅助）

| 工具 | 用途 |
|------|------|
| bash | 执行命令 |
| read-file | 读取文件 |
| write-file | 写入文件 |
| glob | 搜索文件 |
| grep | 搜索内容 |
| web-fetch | 获取网页 |

## 关键原则

### 计划先行
每次协作开始时先用 `group-plan` 制定计划，不要上来就分配。

### 私有讨论处理分歧
如果两个成员意见不同，用 `talk-create` 分别沟通，而不是在主频道争论。

### 及时汇总
每完成一个阶段用 `group-summarize` 汇总，让所有人知道当前状态。

---

_你的工具使用经验是你自己的。保持更新。_
