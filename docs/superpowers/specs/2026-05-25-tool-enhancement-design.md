# 方案 2 — 工具增强 设计规格

> 来源: `docs/调研/综合调研-可执行改进方案.txt` 方案 2
> 窗口 D, 优先级 P1, 复杂度低

## 概述

参照 claw-code 的工具设计，增强 CoBeing 三个核心文件操作工具：edit-file、grep、bash。

## A. edit-file 增强

### 参数

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `path` | string | 是 | — | 文件路径（相对 workingDir） |
| `old_string` | string | 是 | — | 要替换的文本，必须在文件中精确匹配 |
| `new_string` | string | 是 | — | 替换后的文本，必须与 old_string 不同 |
| `replace_all` | boolean | 否 | false | 是否替换所有匹配出现 |

### 行为规则

1. **`old_string` ≠ `new_string`** — 相同时返回错误
2. **精确匹配** — 使用 `indexOf` 在文件内容中查找 `old_string`
3. **`replace_all: false`（默认）** — 要求 `old_string` 在文件中唯一出现；出现多次时返回错误提示提供更多上下文
4. **`replace_all: true`** — 使用 `String.prototype.replaceAll` 替换所有出现
5. **匹配失败** — 返回: `"old_string not found in file. Please read the file first to get the exact current content."`
6. **受保护路径** — 保持现有 `isProtectedPath` 检查不变

### 输出格式

成功时返回结构化摘要：

```
Edit applied to <relPath>
- occurrences: <N>
- old: <first 80 chars of old_string>
- new: <first 80 chars of new_string>
```

失败时返回 `isError: true` + 具体原因。

### 修改文件

- `packages/core/src/tools/edit-file.ts` — 主实现

## B. grep 增强

### 参数

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `pattern` | string | 是 | — | 正则表达式 |
| `path` | string | 否 | `"."` | 搜索目录（相对 workingDir） |
| `glob` | string | 否 | — | 文件名 glob 过滤，如 `*.ts`。替代原 `include` 参数 |
| `include` | string | 否 | — | **deprecated** — `glob` 的别名，保留向后兼容 |
| `output_mode` | string | 否 | `"content"` | `"content"` / `"files_with_matches"` / `"count"` |
| `head_limit` | number | 否 | 250 | 最大输出条数。0 = 无限制 |
| `offset` | number | 否 | 0 | 跳过前 N 条结果再输出 |
| `-A` | number | 否 | — | 匹配行后显示 N 行上下文 |
| `-B` | number | 否 | — | 匹配行前显示 N 行上下文 |
| `-C` | number | 否 | — | 匹配行前后各显示 N 行上下文 |
| `multiline` | boolean | 否 | false | 启用 dotAll + multiline 正则模式 |
| `-i` | boolean | 否 | true | 大小写不敏感 |
| `-n` | boolean | 否 | true | 显示行号 |

### output_mode 行为

- **`"content"`** — 输出匹配行内容。格式: `relPath:lineNum: text`（`-n: false` 时省略 `:lineNum`）。支持 `-A/-B/-C` 上下文行、`head_limit`、`offset`
- **`"files_with_matches"`** — 仅输出匹配文件的相对路径列表（去重）。支持 `head_limit`、`offset`
- **`"count"`** — 输出每个文件的匹配数量。格式: `relPath: N`。支持 `head_limit`、`offset`

### 分页逻辑

```
收集所有结果 → offset 跳过 → head_limit 截断
超出 head_limit 时追加提示: "... and <N> more results"
```

### 上下文行显示

`-A/-B/-C` 仅在 `output_mode: "content"` 时生效。上下文行以 `relPath-N: text` 格式显示（N 为行号），与匹配行通过 `--` 分隔不同匹配块。

### glob 参数

- 参数名 `glob` 对齐 claw-code
- `include` 保留为 deprecated alias — 当用户提供 `include` 时内部映射为 `glob`，无警告
- 当同时提供 `glob` 和 `include` 时，`glob` 优先生效
- 现有 `globToRegex` 函数保持不变

### 修改文件

- `packages/core/src/tools/grep.ts` — 主实现

## C. bash 增强

### 参数（无变化）

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `command` | string | 是 | — | 要执行的命令 |
| `timeout` | number | 否 | 30 | 超时秒数 |

### 行为变化

1. **输出截断** — stdout 超过 16384 字节时截断为前 16384 字符 + 追加 `[output truncated — exceeded 16384 bytes]`
2. **超时验证** — 当前 `exec()` 已正确接收 `{ timeout }` 选项，无需修改。仅做验证性确认

### 截断实现

在 `executeLocal()` 返回结果前检查 stdout 长度。截断策略：取前 16384 字符（按字符数而非字节数，兼容多字节 UTF-8）。

### 修改文件

- `packages/core/src/tools/bash.ts` — 主实现

## 测试计划

三个工具增强均在 `packages/core/src/tools/` 下新增测试文件：

- `edit-file.test.ts` — 覆盖: 基本替换、replace_all、old_string=new_string 拒绝、匹配失败、多次出现+非 replace_all、受保护路径
- `grep.test.ts` — 覆盖: 三种 output_mode、head_limit+offset 分页、-A/-B/-C 上下文、multiline、-i 大小写敏感、-n 隐藏行号、glob/include alias
- `bash.test.ts` — 覆盖: 正常执行、输出截断（>16384 字节）、超时

## 不涉及

- 前端 — 纯后端工具增强，前端无变更
- Agent 注册 — 工具名不变，`agent.ts` 中的注册代码无需修改
- 配置 — 无新增配置项
- 沙箱 — bash 的 sandbox 分支无需改动（sandboxRunner 内部已有自己的截断逻辑）
