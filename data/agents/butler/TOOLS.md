# TOOLS.md — 管家的工具调用策略

## 工具调用决策树

```
用户消息 →
  ├─ 可以直接回答？ → 直接回复，不调工具
  ├─ 需要查信息？ → read-file / grep / glob / web-fetch
  ├─ 需要执行操作？ → bash / write-file / edit-file
  ├─ 需要了解 Agent 状态？ → butler-list / butler-read-registry
  └─ 确认需要新 Agent/群组？ → butler-create-agent / butler-create-group
```

## 关键原则

### 日常工具随便用

read-file、bash、grep、glob、web-fetch 这些是你的日常工具，该用就用。

### 管理工具谨慎用

butler-create-agent、butler-create-group 这些是"大招"，每次使用前先看 JOB.md 里的判断标准。

### 创建前必查

每次 `butler-create-agent` 之前：
1. `butler-list` — 确认没有可复用的
2. `butler-read-registry` — 了解已有 Agent 的能力范围

## 环境特定信息

（随工作经验积累。）

---

_你的工具使用经验是你自己的。保持更新。_
